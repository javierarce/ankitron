// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anki;

use anki::{ensure_anki_running, is_ankiconnect_up, stop_spawned_anki, AnkiState};
use std::sync::Arc;

/// Wait until AnkiConnect is responding (called by the frontend on startup).
/// Polls the HTTP endpoint directly — no dependency on background task state.
#[tauri::command]
async fn wait_for_anki() -> Result<bool, String> {
    if is_ankiconnect_up().await {
        return Ok(true);
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if is_ankiconnect_up().await {
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
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
        .child
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);

    stop_spawned_anki(&state);

    if we_spawned {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
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

fn main() {
    let anki_state = Arc::new(AnkiState::default());
    let startup_state = anki_state.clone();
    let cleanup_state = anki_state.clone();

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
                use tauri::menu::{Menu, MenuItem, MenuItemKind};

                let handle = app.handle();
                let menu = Menu::default(handle)?;
                if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
                    let about =
                        MenuItem::with_id(handle, "about", "About AnkiTron", true, None::<&str>)?;
                    if let Some(native_about) = app_menu.items()?.first() {
                        app_menu.remove(native_about)?;
                    }
                    app_menu.prepend(&about)?;
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
            if event.id().as_ref() == "about" {
                use tauri::Emitter;
                let _ = app.emit("show-about", ());
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
            stop_anki_for_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running AnkiTron");
}
