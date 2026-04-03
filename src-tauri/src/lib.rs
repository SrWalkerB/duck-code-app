mod commands;
mod db;
mod process;

use db::DbState;
use process::ProcessState;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let conn = db::init_db(app.handle())?;
            app.manage(DbState(Mutex::new(conn)));
            app.manage(ProcessState(Mutex::new(HashMap::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::list_projects,
            commands::update_project,
            commands::delete_project,
            commands::create_thread,
            commands::list_threads,
            commands::update_thread,
            commands::delete_thread,
            commands::list_messages,
            commands::save_assistant_message,
            commands::pick_folder,
            commands::send_message,
            commands::stop_generation,
            commands::list_skills,
            commands::read_directory,
            commands::read_file_content,
            commands::git_status,
            commands::git_diff,
            commands::git_log,
            commands::git_branches,
            commands::get_claude_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
