use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const ANKICONNECT_URL: &str = "http://127.0.0.1:8765";

/// Holds the headless Anki process we own so we can kill it on exit.
///
/// `anki_pid` is the source of truth for ownership and is set whether we
/// spawned the process in this run (`child` is also `Some`) or adopted an
/// orphan from a previous run via the pidfile (`child` stays `None` because
/// we have no OS handle for a process we didn't fork). A user's own Anki is
/// never recorded here, so it is never killed.
pub struct AnkiState {
    pub child: Mutex<Option<Child>>,
    pub anki_pid: Mutex<Option<u32>>,
    pub watchdog: Mutex<Option<Child>>,
}

impl Default for AnkiState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            anki_pid: Mutex::new(None),
            watchdog: Mutex::new(None),
        }
    }
}

impl Drop for AnkiState {
    fn drop(&mut self) {
        stop_spawned_anki(self);
    }
}

/// Path to the file recording the PID of the headless Anki we spawned, so a
/// later run (or one started after a crash) can recognise and reclaim it.
fn pidfile_path() -> Option<PathBuf> {
    let dir = dirs::cache_dir()?.join("Ankitron");
    Some(dir.join("anki.pid"))
}

fn write_pidfile(pid: u32) {
    if let Some(path) = pidfile_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, pid.to_string());
    }
}

fn read_pidfile() -> Option<u32> {
    let path = pidfile_path()?;
    std::fs::read_to_string(&path).ok()?.trim().parse().ok()
}

fn remove_pidfile() {
    if let Some(path) = pidfile_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// True if a process with this PID currently exists (sends signal 0).
fn pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// True if the live process looks like an Anki binary. Guards against PID
/// reuse: a stale pidfile could point at a number now owned by something
/// unrelated, and we must never signal that.
fn looks_like_anki(pid: u32) -> bool {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .to_lowercase()
                .contains("anki")
        })
        .unwrap_or(false)
}

/// Send SIGTERM, give the process a moment to flush and exit, then escalate to
/// SIGKILL if it's still alive. Returns once the process is gone (or we gave up
/// escalating). A graceful term lets Anki release its collection lock cleanly.
fn graceful_kill(pid: u32) {
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    for _ in 0..8 {
        if !pid_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
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
            *state.anki_pid.lock().unwrap() = Some(anki_pid);
            write_pidfile(anki_pid);
            spawn_watchdog(state, anki_pid);
            true
        }
        Err(_) => false,
    }
}

/// If AnkiConnect is already up but we don't own a process, check whether the
/// live instance is a headless Anki we spawned in a previous run (recorded in
/// the pidfile). If so, adopt it so it is cleaned up on exit and gets a fresh
/// watchdog. A user's own Anki — no pidfile, or a pidfile pointing at a dead /
/// reused PID — is deliberately left untracked and untouched.
fn adopt_orphan_if_ours(state: &AnkiState) {
    if state.anki_pid.lock().map(|g| g.is_some()).unwrap_or(true) {
        return; // we already own a process
    }

    let pid = match read_pidfile() {
        Some(p) => p,
        None => return,
    };

    if !pid_alive(pid) {
        remove_pidfile(); // stale entry from a process that already exited
        return;
    }

    if !looks_like_anki(pid) {
        return; // PID was reused by some other process — not ours
    }

    *state.anki_pid.lock().unwrap() = Some(pid);
    spawn_watchdog(state, pid);
}

/// Spawn a watchdog process that kills Anki if Ankitron exits without running
/// cleanup (a crash or force-quit). The watchdog polls our PID and, once we
/// disappear, sends SIGTERM and then escalates to SIGKILL if Anki is still
/// alive a few seconds later — a single SIGTERM can be missed while Anki is
/// busy, which would otherwise leave a permanent orphan holding the collection
/// lock. It also clears the pidfile so the next run starts clean.
fn spawn_watchdog(state: &AnkiState, anki_pid: u32) {
    let our_pid = std::process::id();
    let rm_pidfile = pidfile_path()
        .map(|p| format!("rm -f '{}'", p.to_string_lossy()))
        .unwrap_or_default();

    let script = format!(
        "while kill -0 {our} 2>/dev/null; do sleep 1; done; \
         kill {anki} 2>/dev/null; \
         i=0; while kill -0 {anki} 2>/dev/null && [ $i -lt 16 ]; do sleep 0.5; i=$((i+1)); done; \
         kill -9 {anki} 2>/dev/null; \
         {rm}",
        our = our_pid,
        anki = anki_pid,
        rm = rm_pidfile,
    );

    let result = Command::new("/bin/sh")
        .args(["-c", &script])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();

    if let Ok(wd) = result {
        // Replace any previous watchdog so we don't leak one when re-adopting.
        if let Ok(mut guard) = state.watchdog.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
                let _ = old.wait();
            }
            *guard = Some(wd);
        }
    }
}

/// Kill the Anki process and watchdog we own (spawned or adopted), gracefully,
/// and clear the pidfile. Idempotent: safe to call from multiple exit paths.
pub fn stop_spawned_anki(state: &AnkiState) {
    // Kill the watchdog first so it doesn't race us escalating to SIGKILL.
    if let Ok(mut guard) = state.watchdog.lock() {
        if let Some(mut wd) = guard.take() {
            let _ = wd.kill();
            let _ = wd.wait();
        }
    }

    let pid = state.anki_pid.lock().ok().and_then(|g| *g);
    if let Some(pid) = pid {
        graceful_kill(pid);
    }

    // Reap our own child if we have a handle, so we don't leave a zombie.
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    if let Ok(mut guard) = state.anki_pid.lock() {
        *guard = None;
    }
    remove_pidfile();
}

/// Ensure Anki is running. If AnkiConnect is already up, adopt the instance if
/// it's a headless one we previously spawned; otherwise spawn Anki headless and
/// poll until it responds or we hit the timeout.
pub async fn ensure_anki_running(state: &AnkiState) -> bool {
    if is_ankiconnect_up().await {
        adopt_orphan_if_ours(state);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pidfile_round_trips() {
        // Use our own PID so it parses and is guaranteed alive.
        let me = std::process::id();
        write_pidfile(me);
        assert_eq!(read_pidfile(), Some(me));
        assert!(pid_alive(me));
        remove_pidfile();
        assert_eq!(read_pidfile(), None);
    }

    #[test]
    fn dead_pid_not_alive() {
        // PID 0 is never a normal user process; `kill -0 0` targets the
        // process group, so use a very high, almost-certainly-unused PID.
        assert!(!pid_alive(4_000_000_000));
    }
}
