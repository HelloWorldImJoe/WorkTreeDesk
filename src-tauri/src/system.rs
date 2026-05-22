use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use crate::{
    common::{clean_optional_string, clean_required, expand_home, path_arg, run_blocking},
    models::{OpenPathRequest, OpenUrlRequest},
};

#[tauri::command]
pub(crate) async fn open_path(request: OpenPathRequest) -> Result<(), String> {
    run_blocking(move || open_path_sync(request)).await
}

fn open_path_sync(request: OpenPathRequest) -> Result<(), String> {
    let path = expand_home(&request.path)?;
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    match request.editor.as_str() {
        "file-manager" | "finder" => open_file_manager(&path),
        "custom" => {
            let command = clean_optional_string(&request.custom_command)
                .ok_or_else(|| "Custom command is required.".to_string())?;
            spawn_process(&command, &[path_arg(&path)])
        }
        editor => open_editor(editor, &path),
    }
}

#[tauri::command]
pub(crate) async fn open_url(request: OpenUrlRequest) -> Result<(), String> {
    run_blocking(move || open_url_sync(request)).await
}

fn open_url_sync(request: OpenUrlRequest) -> Result<(), String> {
    let url = clean_required(&request.url, "URL")?;

    match request.editor.as_deref() {
        Some("vscode") => open_url_in_vscode(&url),
        _ => open_external_url(&url),
    }
}

#[tauri::command]
pub(crate) async fn copy_text(text: String) -> Result<(), String> {
    run_blocking(move || copy_text_sync(text)).await
}

fn copy_text_sync(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Err("Nothing to copy.".to_string());
    }

    if cfg!(target_os = "macos") {
        pipe_process("pbcopy", &[], &text)
    } else if cfg!(target_os = "windows") {
        pipe_process(
            "powershell",
            &[
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "Set-Clipboard -Value ([Console]::In.ReadToEnd())".to_string(),
            ],
            &text,
        )
    } else {
        pipe_process("wl-copy", &[], &text)
            .or_else(|_| pipe_process("xclip", &["-selection".into(), "clipboard".into()], &text))
    }
}

fn spawn_process(command: &str, args: &[String]) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .spawn()
        .map_err(|error| format!("Failed to launch {command}: {error}"))?;

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

fn pipe_process(command: &str, args: &[String], input: &str) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch {command}: {error}"))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("Failed to open stdin for {command}"))?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| format!("Failed to write clipboard data to {command}: {error}"))?;
    }

    let status = child
        .wait()
        .map_err(|error| format!("Failed waiting for {command}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("{command} exited with status {status}"))
    }
}

fn open_file_manager(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        spawn_process("explorer", &[path_arg(path)])
    } else if cfg!(target_os = "macos") {
        spawn_process("open", &[path_arg(path)])
    } else {
        spawn_process("xdg-open", &[path_arg(path)])
    }
}

fn open_editor(editor: &str, path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        if let Some(app_name) = mac_editor_app(editor) {
            if spawn_process("open", &["-a".into(), app_name.into(), path_arg(path)]).is_ok() {
                return Ok(());
            }
        }
    }

    let mut errors = Vec::new();
    for command in editor_commands(editor) {
        match spawn_process(command, &[path_arg(path)]) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    if editor_commands(editor).is_empty() && mac_editor_app(editor).is_none() {
        Err(format!("Unsupported editor: {editor}"))
    } else {
        Err(format!(
            "Could not launch editor `{editor}`. Tried: {}",
            errors.join("; ")
        ))
    }
}

fn open_external_url(url: &str) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        spawn_process("explorer", &[url.to_string()])
    } else if cfg!(target_os = "macos") {
        spawn_process("open", &[url.to_string()])
    } else {
        spawn_process("xdg-open", &[url.to_string()])
    }
}

fn open_url_in_vscode(url: &str) -> Result<(), String> {
    if spawn_process("code", &["--open-url".to_string(), url.to_string()]).is_ok() {
        return Ok(());
    }

    if cfg!(target_os = "macos")
        && spawn_process(
            "open",
            &[
                "-a".to_string(),
                "Visual Studio Code".to_string(),
                url.to_string(),
            ],
        )
        .is_ok()
    {
        return Ok(());
    }

    open_external_url(url)
}

fn mac_editor_app(editor: &str) -> Option<&'static str> {
    match editor {
        "vscode" => Some("Visual Studio Code"),
        "cursor" => Some("Cursor"),
        "windsurf" => Some("Windsurf"),
        "zed" => Some("Zed"),
        "sublime" => Some("Sublime Text"),
        "webstorm" => Some("WebStorm"),
        "idea" => Some("IntelliJ IDEA"),
        "pycharm" => Some("PyCharm"),
        "goland" => Some("GoLand"),
        "phpstorm" => Some("PhpStorm"),
        "clion" => Some("CLion"),
        "rider" => Some("Rider"),
        "android-studio" => Some("Android Studio"),
        "xcode" => Some("Xcode"),
        "nova" => Some("Nova"),
        "textmate" => Some("TextMate"),
        "emacs" => Some("Emacs"),
        _ => None,
    }
}

fn editor_commands(editor: &str) -> &'static [&'static str] {
    match editor {
        "vscode" => &["code"],
        "cursor" => &["cursor"],
        "windsurf" => &["windsurf"],
        "zed" => &["zed"],
        "sublime" => &["subl", "sublime_text"],
        "webstorm" => &["webstorm", "webstorm64"],
        "idea" => &["idea", "idea64"],
        "pycharm" => &["pycharm", "pycharm64"],
        "goland" => &["goland", "goland64"],
        "phpstorm" => &["phpstorm", "phpstorm64"],
        "clion" => &["clion", "clion64"],
        "rider" => &["rider", "rider64"],
        "android-studio" => &["studio", "studio64", "android-studio"],
        "xcode" => &["xed"],
        "nova" => &["nova"],
        "textmate" => &["mate"],
        "emacs" => &["emacs", "runemacs"],
        _ => &[],
    }
}
