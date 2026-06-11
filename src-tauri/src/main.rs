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

fn main() {
    let anki_state = Arc::new(AnkiState::default());
    let startup_state = anki_state.clone();
    let cleanup_state = anki_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Managed so the `ensure_anki` command can reach the same state and
        // keep the spawned Anki process alive for the app's lifetime.
        .manage(anki_state)
        .setup(move |_app| {
            // Spawn Anki in background during startup
            tauri::async_runtime::spawn(async move {
                if !ensure_anki_running(&startup_state).await {
                    eprintln!("Warning: Could not start Anki. Make sure Anki is installed.");
                }
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_spawned_anki(&cleanup_state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            wait_for_anki,
            ensure_anki,
            anki_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running AnkiTron");
}
