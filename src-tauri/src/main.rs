// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anki;
mod elevenlabs;

use anki::{ensure_anki_running, is_anki_installed, is_ankiconnect_up, stop_spawned_anki, AnkiState};
use elevenlabs::{elevenlabs_tts, elevenlabs_voices, set_elevenlabs_api_key};
use std::sync::Arc;

/// Wait until AnkiConnect is responding (called by the frontend on startup).
/// Polls the HTTP endpoint directly — no dependency on background task state.
///
/// Returns a reason string so the frontend can show the right guidance instead
/// of one generic error:
///   "connected" — AnkiConnect answered on port 8765.
///   "no-anki"   — the Anki app isn't installed, so there's nothing to wait for.
///   "no-addon"  — Anki is installed (and being launched) but the port never
///                 opened, so the AnkiConnect add-on is almost certainly missing.
#[tauri::command]
async fn wait_for_anki() -> Result<String, String> {
    if is_ankiconnect_up().await {
        return Ok("connected".into());
    }
    // No Anki executable means the background launcher can never bring the port
    // up — skip the wait and tell the user to install Anki right away.
    if !is_anki_installed() {
        return Ok("no-anki".into());
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if is_ankiconnect_up().await {
            return Ok("connected".into());
        }
        if tokio::time::Instant::now() >= deadline {
            // Anki is present but nothing ever answered on 8765: the AnkiConnect
            // add-on isn't installed (or is disabled/misconfigured).
            return Ok("no-addon".into());
        }
    }
}

/// (Re)launch Anki in the background if it isn't reachable, then wait for it.
/// Called by the frontend's "Try again" — Anki may have been closed after
/// startup, in which case nothing else would restart it.
#[tauri::command]
async fn ensure_anki(state: tauri::State<'_, Arc<AnkiState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    Ok(ensure_anki_running(&state).await)
}

/// Proxy a request to AnkiConnect, bypassing CORS restrictions.
/// The frontend calls this via `invoke("anki_request", { body })`.
#[tauri::command]
async fn anki_request(body: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("http://127.0.0.1:8765")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AnkiConnect request failed: {}", e))?;

    resp.json()
        .await
        .map_err(|e| format!("Failed to parse AnkiConnect response: {}", e))
}

/// Stop the headless Anki we spawned and wait for AnkiConnect to actually go
/// down before the app relaunches for an update. Without this, the relaunched
/// process can latch onto the dying instance (briefly still answering on :8765)
/// and skip spawning its own, leaving the app with no Anki. Only waits when we
/// were the ones who spawned Anki — a user's own Anki is left untouched and the
/// relaunched app simply reuses it.
#[tauri::command]
async fn stop_anki_for_update(state: tauri::State<'_, Arc<AnkiState>>) -> Result<(), String> {
    let state = state.inner().clone();
    let we_spawned = state
        .anki_pid
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);

    // stop_spawned_anki is blocking (SIGTERM, std::thread::sleep while waiting
    // for the process to exit, then SIGKILL, plus synchronous `kill`/`ps`
    // subprocesses). Run it on the blocking pool so it can't stall other Tauri
    // commands on the async runtime while the update dialog waits on us.
    let kill_state = state.clone();
    tokio::task::spawn_blocking(move || stop_spawned_anki(&kill_state))
        .await
        .map_err(|e| format!("Anki shutdown task failed: {}", e))?;

    // graceful_kill above already waits for the process to actually exit, so
    // :8765 is normally clear by now; this is a short belt-and-suspenders wait
    // for the port to release before the relaunched app spawns its own Anki.
    if we_spawned {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while is_ankiconnect_up().await {
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    Ok(())
}

/// Write text to an absolute path the user chose via the native save dialog.
/// Lets the deck export land wherever the user picks (folder + filename)
/// instead of being dumped into ~/Downloads by a browser-style download.
#[tauri::command]
async fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

const FEEDBACK_EMAIL: &str = "ankitron+feedback@javier.computer";
const BUG_EMAIL: &str = "ankitron+bugs@javier.computer";

/// Percent-encode a mailto query value. `url` isn't a direct dependency and the
/// alphabet here is tiny, so encode everything outside the unreserved set —
/// over-encoding is always safe in a query string.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            // RFC 6068 requires CRLF line breaks in the body. Mail.app accepts
            // a bare LF, but a handler that splits strictly on CRLF would run
            // the whole template together on one line. Callers pass plain "\n".
            b'\n' => out.push_str("%0D%0A"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// Human-readable OS line for the report footer, e.g.
/// "macOS Version 26.5.2 (Build 25F84)". Falls back to just the OS name when
/// `sw_vers` isn't available (non-macOS, or it failed to run).
fn os_description() -> String {
    #[cfg(target_os = "macos")]
    {
        let read = |arg: &str| {
            std::process::Command::new("sw_vers")
                .arg(arg)
                .output()
                .ok()
                .filter(|out| out.status.success())
                .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        };
        if let Some(version) = read("-productVersion") {
            return match read("-buildVersion") {
                Some(build) => format!("macOS Version {} (Build {})", version, build),
                None => format!("macOS Version {}", version),
            };
        }
        return "macOS".into();
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::env::consts::OS.to_string()
    }
}

/// Footer appended to both Help > mail templates so reports arrive with the
/// app and OS versions already filled in.
fn report_footer(app_version: &str) -> String {
    format!("\u{2014}\nAnkitron {}\n{}", app_version, os_description())
}

fn feedback_mailto(app_version: &str) -> String {
    // No prompt text: feedback is free-form, so the draft is just empty space
    // above the version footer.
    let body = format!("\n\n\n{}", report_footer(app_version));
    format!(
        "mailto:{}?subject={}&body={}",
        FEEDBACK_EMAIL,
        encode("Ankitron Feedback"),
        encode(&body)
    )
}

fn bug_mailto(app_version: &str) -> String {
    let body = format!(
        "Hi,\n\nI seem to have found a bug!\n\n\
         Description\n[insert short description of the bug]\n\n\
         What I was doing\n[describe in as much detail as possible what you were doing when the bug happened]\n\n\
         Other Information\n[insert other details]\n{}",
        report_footer(app_version)
    );
    format!(
        "mailto:{}?subject={}&body={}",
        BUG_EMAIL,
        encode("Ankitron Bug Report"),
        encode(&body)
    )
}

fn main() {
    let anki_state = Arc::new(AnkiState::default());
    let startup_state = anki_state.clone();
    let cleanup_state = anki_state.clone();
    let exit_state = anki_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        // Managed so the `ensure_anki` command can reach the same state and
        // keep the spawned Anki process alive for the app's lifetime.
        .manage(anki_state)
        .setup(move |app| {
            // Replace the native About panel with an in-app dialog so it can
            // show credits with a clickable link. macOS only — other
            // platforms have no default menu bar.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, MenuItemKind, HELP_SUBMENU_ID};

                let handle = app.handle();
                let menu = Menu::default(handle)?;
                let items = menu.items()?;
                if let Some(MenuItemKind::Submenu(app_menu)) = items.first() {
                    let about =
                        MenuItem::with_id(handle, "about", "About Ankitron", true, None::<&str>)?;
                    if let Some(native_about) = app_menu.items()?.first() {
                        app_menu.remove(native_about)?;
                    }
                    app_menu.prepend(&about)?;
                }
                // The default Help submenu is empty on macOS (the system adds
                // only its search field), so both mail shortcuts go there.
                if let Some(MenuItemKind::Submenu(help_menu)) =
                    items.iter().find(|item| item.id() == HELP_SUBMENU_ID)
                {
                    help_menu.append(&MenuItem::with_id(
                        handle,
                        "send-feedback",
                        "Send Feedback…",
                        true,
                        None::<&str>,
                    )?)?;
                    help_menu.append(&MenuItem::with_id(
                        handle,
                        "report-bug",
                        "Report a Bug…",
                        true,
                        None::<&str>,
                    )?)?;
                }
                app.set_menu(menu)?;
            }

            // Spawn Anki in background during startup
            tauri::async_runtime::spawn(async move {
                if !ensure_anki_running(&startup_state).await {
                    eprintln!("Warning: Could not start Anki. Make sure Anki is installed.");
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri_plugin_shell::ShellExt;

            let version = app.package_info().version.to_string();
            match event.id().as_ref() {
                "about" => {
                    use tauri::Emitter;
                    let _ = app.emit("show-about", ());
                }
                // `Shell::open` is deprecated in favour of tauri-plugin-opener,
                // but the app already ships plugin-shell (the in-app links use
                // it), so there's no reason to pull in a second plugin here.
                #[allow(deprecated)]
                "send-feedback" => {
                    let _ = app.shell().open(feedback_mailto(&version), None);
                }
                #[allow(deprecated)]
                "report-bug" => {
                    let _ = app.shell().open(bug_mailto(&version), None);
                }
                _ => {}
            }
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_spawned_anki(&cleanup_state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            wait_for_anki,
            ensure_anki,
            anki_request,
            save_text_file,
            stop_anki_for_update,
            set_elevenlabs_api_key,
            elevenlabs_tts,
            elevenlabs_voices
        ])
        .build(tauri::generate_context!())
        .expect("error while running Ankitron")
        // Also clean up on app exit (e.g. Cmd+Q / Quit), not just when the
        // window is destroyed — otherwise a quit path that skips the window
        // event would leave the headless Anki orphaned, holding the collection
        // lock so the user can't reopen the desktop Anki. Idempotent with the
        // window handler above.
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                stop_spawned_anki(&exit_state);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Naive percent-decoder, test-only: turns an encoded query value back into
    /// the text the mail client will show.
    fn decode(value: &str) -> String {
        let bytes = value.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
                out.push(u8::from_str_radix(hex, 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).unwrap()
    }

    fn parts(url: &str) -> (String, String, String) {
        let (to, query) = url
            .strip_prefix("mailto:")
            .unwrap()
            .split_once('?')
            .unwrap();
        let (subject, body) = query.split_once("&body=").unwrap();
        (
            to.into(),
            decode(subject.strip_prefix("subject=").unwrap()),
            decode(body),
        )
    }

    /// What a template's plain "\n" text looks like once encoded and decoded
    /// again: RFC 6068 line breaks, i.e. CRLF.
    fn as_sent(text: &str) -> String {
        text.replace('\n', "\r\n")
    }

    #[test]
    fn bug_mailto_is_addressed_and_prefilled() {
        let (to, subject, body) = parts(&bug_mailto("1.1.0"));
        assert_eq!(to, "ankitron+bugs@javier.computer");
        assert_eq!(subject, "Ankitron Bug Report");
        assert!(body.starts_with(&as_sent(
            "Hi,\n\nI seem to have found a bug!\n\nDescription\n"
        )));
        assert!(body.contains(&as_sent("\nWhat I was doing\n")));
        assert!(body.contains(&as_sent("\nOther Information\n")));
        assert!(body.contains(&as_sent("\u{2014}\nAnkitron 1.1.0\n")));
    }

    #[test]
    fn feedback_mailto_is_addressed_and_signed() {
        let (to, subject, body) = parts(&feedback_mailto("1.1.0"));
        assert_eq!(to, "ankitron+feedback@javier.computer");
        assert_eq!(subject, "Ankitron Feedback");
        assert!(body.starts_with("\r\n\r\n"));
        assert!(body.ends_with(&as_sent(&report_footer("1.1.0"))));
    }

    /// A handler that splits strictly on CRLF must not see a lone LF, or the
    /// whole template collapses onto one line.
    #[test]
    fn bodies_break_lines_with_crlf_only() {
        for url in [bug_mailto("1.1.0"), feedback_mailto("1.1.0")] {
            let (_, _, body) = parts(&url);
            assert!(body.contains("\r\n"), "no CRLF in {}", url);
            assert!(!body.replace("\r\n", "").contains('\n'), "bare LF in {}", url);
        }
    }

    #[test]
    fn os_description_reports_the_host() {
        let os = os_description();
        assert!(!os.is_empty());
        #[cfg(target_os = "macos")]
        assert!(os.starts_with("macOS"), "unexpected: {}", os);
    }
}
