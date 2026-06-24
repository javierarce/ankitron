//! ElevenLabs text-to-speech proxy.
//!
//! The frontend never holds the API key or talks to ElevenLabs directly: the
//! key lives in the OS keychain (encrypted at rest, gated by the user's login)
//! and these commands read it server-side. Proxying through Rust also sidesteps
//! the webview's CSP (which only allows AnkiConnect) and CORS — the same reason
//! `anki_request` exists.

use base64::Engine;
use keyring::Entry;
use std::sync::Mutex;

/// Keychain coordinates for the stored API key. The service matches the app's
/// bundle identifier so the credential is namespaced to Ankitron.
const KEYRING_SERVICE: &str = "com.ankitron.app";
const KEYRING_ACCOUNT: &str = "elevenlabs-api-key";

/// In-memory copy of the key, populated on first read. Generating a few clips in
/// one session would otherwise re-read the keychain each time — and every read
/// can raise a macOS access prompt (constantly in unsigned dev builds). With the
/// cache the keychain is touched at most once per app launch; it's kept in sync
/// whenever the key is saved or cleared.
static KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

const TTS_URL: &str = "https://api.elevenlabs.io/v1/text-to-speech";
const VOICES_URL: &str = "https://api.elevenlabs.io/v1/voices";

/// An error surfaced to the frontend. `kind` lets the caller tell a genuine
/// auth/permission failure (the key is bad — safe to discard) from a transient
/// one (offline, rate limit, server error — keep the key and let the user
/// retry). Serialized to JS as `{ kind, message }`.
#[derive(serde::Serialize)]
pub struct ApiError {
    kind: String,
    message: String,
}

impl ApiError {
    fn auth(message: String) -> Self {
        ApiError { kind: "auth".to_string(), message }
    }
}

/// Plumbing failures (no key set, network send error, decode) — none are an
/// auth verdict, so they default to transient.
impl From<String> for ApiError {
    fn from(message: String) -> Self {
        ApiError { kind: "transient".to_string(), message }
    }
}

fn key_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keychain unavailable: {e}"))
}

/// Read the stored key, or None if the user hasn't set one yet.
fn read_api_key() -> Result<Option<String>, String> {
    match key_entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the API key: {e}")),
    }
}

/// Store the ElevenLabs API key in the OS keychain. An empty string clears it,
/// so the Settings "Remove" button and "Save" share one command.
#[tauri::command]
pub fn set_elevenlabs_api_key(key: String) -> Result<(), String> {
    let entry = key_entry()?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("Could not clear the API key: {e}")),
        }
        *KEY_CACHE.lock().unwrap() = None;
        return Ok(());
    }
    entry
        .set_password(trimmed)
        .map_err(|e| format!("Could not save the API key: {e}"))?;
    *KEY_CACHE.lock().unwrap() = Some(trimmed.to_string());
    Ok(())
}

fn require_key() -> Result<String, String> {
    // Serve the cached key when we have it; only fall back to the keychain on
    // the first use after launch.
    if let Some(key) = KEY_CACHE.lock().unwrap().clone() {
        return Ok(key);
    }
    let key = read_api_key()?
        .ok_or_else(|| "No ElevenLabs API key set. Add one in Settings.".to_string())?;
    *KEY_CACHE.lock().unwrap() = Some(key.clone());
    Ok(key)
}

/// Turn a failed ElevenLabs response into a human-readable message. Their error
/// bodies are JSON like `{"detail":{"status":"missing_permissions","message":"…"}}`
/// or `{"detail":"…"}`; we pull out the message instead of dumping raw JSON, and
/// add a hint for the cases users actually hit (bad key, missing permission,
/// quota).
async fn error_message(resp: reqwest::Response) -> ApiError {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();
    let detail = parsed.as_ref().and_then(|v| v.get("detail"));
    let detail_status = detail
        .and_then(|d| d.get("status"))
        .and_then(|s| s.as_str());
    // `detail` is either a string or an object with a `message` field.
    let message = detail.and_then(|d| {
        d.as_str().map(str::to_string).or_else(|| {
            d.get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
    });

    // An auth or permission failure means the key itself won't work, so the
    // caller may safely discard it. A 401, a 403, or a missing-permission detail
    // are the auth verdicts; everything else (429, 5xx, …) is transient.
    let is_auth = status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
        || detail_status == Some("missing_permissions");

    if detail_status == Some("missing_permissions") {
        let text = match message {
            // ElevenLabs phrases this as "… missing the permission X to execute
            // this operation."; trim the boilerplate tail to the essential part.
            Some(m) => {
                let core = m
                    .trim_end()
                    .trim_end_matches('.')
                    .trim_end_matches(" to execute this operation");
                format!("{core}.")
            }
            None => "Your ElevenLabs API key is missing a required permission.".to_string(),
        };
        return ApiError::auth(text);
    }

    let text = match (status.as_u16(), message) {
        (401, Some(m)) => format!("ElevenLabs rejected the API key: {m}"),
        (401, None) => "ElevenLabs rejected the API key (401). Check that it's correct \
             and has the right permissions."
            .to_string(),
        (429, Some(m)) => format!("ElevenLabs quota or rate limit reached: {m}"),
        (429, None) => "ElevenLabs quota or rate limit reached. Check your account usage.".to_string(),
        (_, Some(m)) => format!("ElevenLabs error: {m}"),
        (code, None) => format!("ElevenLabs request failed (HTTP {code})."),
    };

    if is_auth {
        ApiError::auth(text)
    } else {
        ApiError::from(text)
    }
}

/// Generate speech for `text` with the given voice and model, returning the
/// audio as base64 (mp3) — the form `storeMediaFile` wants, so the frontend can
/// hand it straight to Anki without touching the bytes.
#[tauri::command]
pub async fn elevenlabs_tts(
    text: String,
    voice_id: String,
    model_id: String,
) -> Result<String, ApiError> {
    let key = require_key()?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{TTS_URL}/{voice_id}"))
        .header("xi-api-key", key)
        .header("accept", "audio/mpeg")
        .query(&[("output_format", "mp3_44100_128")])
        .json(&serde_json::json!({ "text": text, "model_id": model_id }))
        .send()
        .await
        .map_err(|e| format!("ElevenLabs request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Could not read audio from ElevenLabs: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// List the account's voices for the picker. Returns ElevenLabs' raw JSON; the
/// frontend pulls out `voice_id` and `name`.
#[tauri::command]
pub async fn elevenlabs_voices() -> Result<serde_json::Value, ApiError> {
    let key = require_key()?;
    let client = reqwest::Client::new();
    let resp = client
        .get(VOICES_URL)
        .header("xi-api-key", key)
        .send()
        .await
        .map_err(|e| format!("ElevenLabs request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }

    let voices = resp
        .json()
        .await
        .map_err(|e| format!("Could not parse the voice list: {e}"))?;
    Ok(voices)
}
