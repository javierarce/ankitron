use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const ANKICONNECT_URL: &str = "http://127.0.0.1:8765";

/// Holds the Anki process we spawned (if any) so we can kill it on exit.
pub struct AnkiState {
    pub child: Mutex<Option<Child>>,
    pub watchdog: Mutex<Option<Child>>,
}

impl Default for AnkiState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            watchdog: Mutex::new(None),
        }
    }
}

impl Drop for AnkiState {
    fn drop(&mut self) {
        stop_spawned_anki(self);
    }
}

/// Check if AnkiConnect is responding on port 8765.
pub async fn is_ankiconnect_up() -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .unwrap_or_default();

    let body = serde_json::json!({
        "action": "version",
        "version": 6
    });

    match client.post(ANKICONNECT_URL).json(&body).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                return false;
            }
            match resp.json::<serde_json::Value>().await {
                Ok(data) => data["result"].is_number(),
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

/// Locate the Anki executable on disk. Anki 25.09+ uses a uv-based layout
/// with the binary in a managed venv; older versions ship it in the .app bundle.
fn find_anki_executable() -> Option<String> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            home.join("Library/Application Support/AnkiProgramFiles/.venv/bin/anki"),
            std::path::PathBuf::from("/Applications/Anki.app/Contents/MacOS/anki"),
        ];
        for p in &candidates {
            if p.exists() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let venv = home.join(".local/share/AnkiProgramFiles/.venv/bin/anki");
        if venv.exists() {
            return Some(venv.to_string_lossy().into_owned());
        }
        // Fallback: try `anki` on PATH
        return Some("anki".to_string());
    }

    None
}

/// Spawn Anki headless with QT_QPA_PLATFORM=offscreen.
fn spawn_anki_hidden(state: &AnkiState) -> bool {
    let exe = match find_anki_executable() {
        Some(e) => e,
        None => return false,
    };

    let result = Command::new(&exe)
        .env("QT_QPA_PLATFORM", "offscreen")
        .env(
            "QTWEBENGINE_CHROMIUM_FLAGS",
            "--disable-gpu --disable-gpu-compositing --disable-software-rasterizer",
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();

    match result {
        Ok(child) => {
            let anki_pid = child.id();
            *state.child.lock().unwrap() = Some(child);
            spawn_watchdog(state, anki_pid);
            true
        }
        Err(_) => false,
    }
}

/// Spawn a watchdog process that kills Anki if AnkiTron crashes without
/// running cleanup. The watchdog polls our PID and sends SIGTERM to the
/// Anki process group once we disappear.
fn spawn_watchdog(state: &AnkiState, anki_pid: u32) {
    let our_pid = std::process::id();
    let script = format!(
        "while kill -0 {} 2>/dev/null; do sleep 2; done; kill {} 2>/dev/null",
        our_pid, anki_pid
    );

    let result = Command::new("/bin/sh")
        .args(["-c", &script])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();

    if let Ok(wd) = result {
        *state.watchdog.lock().unwrap() = Some(wd);
    }
}

/// Kill the Anki process and watchdog we spawned.
pub fn stop_spawned_anki(state: &AnkiState) {
    // Kill watchdog first so it doesn't race with us.
    if let Ok(mut guard) = state.watchdog.lock() {
        if let Some(ref mut wd) = *guard {
            let _ = wd.kill();
        }
        *guard = None;
    }

    if let Ok(mut guard) = state.child.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
        }
        *guard = None;
    }
}

/// Ensure Anki is running. If AnkiConnect isn't up, spawn Anki headless
/// and poll until it responds or we hit the timeout.
pub async fn ensure_anki_running(state: &AnkiState) -> bool {
    if is_ankiconnect_up().await {
        return true;
    }

    if !spawn_anki_hidden(state) {
        return false;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_ankiconnect_up().await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
    }
}
