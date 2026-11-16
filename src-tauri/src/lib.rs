mod cli;
mod commands;
mod config;
mod error;
mod paths;
mod settings;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            let settings =
                settings::SettingsStore::load(paths.config_dir.join(settings::SETTINGS_FILE))?;
            app.manage(commands::AppState::new(paths, settings));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::shell_status,
            commands::cli_run,
            commands::auth_set,
            commands::auth_delete,
            commands::config_read,
            commands::config_validate,
            commands::config_write,
            commands::config_patch,
            commands::write_text_file,
            commands::settings_get,
            commands::settings_set,
            commands::pick_config,
            commands::pick_directory,
            commands::pick_log_file,
            commands::open_path,
            commands::prepare_update,
            commands::update_install,
            commands::update_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LV24 SEO Optimizer");
}
