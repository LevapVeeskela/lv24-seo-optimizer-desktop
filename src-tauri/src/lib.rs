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
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            let settings =
                settings::SettingsStore::load(paths.config_dir.join(settings::SETTINGS_FILE))?;
            app.manage(commands::AppState { paths, settings });
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
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LV24 SEO Optimizer");
}
