pub mod env_manager;
pub mod project;
pub mod server;
pub mod setup;

use server::ServerState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ServerState {
            backend: Mutex::new(None),
            frontend: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state = app.state::<ServerState>();
                let _ = server::stop_server(app.clone(), state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            server::start_server,
            server::stop_server,
            project::check_project,
            setup::setup_environment,
            setup::generate_boilerplate,
            setup::install_requirements,
            setup::install_frontend,
            env_manager::read_env,
            env_manager::save_env,
            env_manager::generate_default_env,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
