use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    Emitter, Manager,
};
#[cfg(not(target_os = "macos"))]
use tauri::menu::HELP_SUBMENU_ID;

use crate::update::{UPDATE_MENU_EVENT, UPDATE_MENU_ID};

pub(crate) fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            crate::repository::scan_directory,
            crate::repository::add_worktree,
            crate::repository::remove_worktree,
            crate::repository::prune_worktrees,
            crate::repository::refresh_repository,
            crate::repository::list_branches,
            crate::system::open_path,
            crate::system::open_url,
            crate::review::list_pull_requests,
            crate::review::get_pull_request_detail,
            crate::review::approve_pull_request_review,
            crate::review::approve_pull_request_test,
            crate::review::reset_pull_request_review,
            crate::review::reset_pull_request_test,
            crate::review::prepare_code_review,
            crate::review::cleanup_code_review_worktree,
            crate::review::list_gitee_pull_requests,
            crate::review::get_gitee_pull_request_detail,
            crate::review::approve_gitee_pull_request_review,
            crate::review::approve_gitee_pull_request_test,
            crate::review::reset_gitee_pull_request_review,
            crate::review::reset_gitee_pull_request_test,
            crate::review::prepare_gitee_code_review,
            crate::review::cleanup_gitee_code_review_worktree,
            crate::update::check_for_app_update
        ])
        .setup(|app| {
            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == UPDATE_MENU_ID {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit(UPDATE_MENU_EVENT, true);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let update_item = MenuItemBuilder::with_id(UPDATE_MENU_ID, "检查更新").build(app)?;

    #[cfg(target_os = "macos")]
    {
        if let Some(app_submenu) = menu
            .items()?
            .into_iter()
            .find_map(|item| item.as_submenu().cloned())
        {
            let separator = PredefinedMenuItem::separator(app)?;
            app_submenu.insert_items(&[&update_item, &separator], 2)?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(help_submenu) = menu
            .get(HELP_SUBMENU_ID)
            .and_then(|item| item.as_submenu().cloned())
        {
            let separator = PredefinedMenuItem::separator(app)?;
            help_submenu.append_items(&[&separator, &update_item])?;
        }
    }

    Ok(menu)
}
