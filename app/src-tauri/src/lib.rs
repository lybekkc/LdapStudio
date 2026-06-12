mod commands;
mod state;

use state::AppState;
use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ldap_studio_app=debug,ldap_core=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            connect, disconnect, ping,
            list_children, list_children_more, get_entry, set_page_size,
            search_page, search_next_page, cancel_search,
            get_schema,
            modify_entry, delete_entry, add_entry, analyze_siblings, rename_entry,
            save_profile, list_profiles, delete_profile,
            modify_schema_entry,
            export_ldif, export_entries, import_ldif,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LDAP Studio");
}
