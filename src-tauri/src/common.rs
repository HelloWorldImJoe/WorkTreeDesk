use std::path::{Path, PathBuf};

pub(crate) fn expand_home(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Path is required.".to_string());
    }

    if path == "~" {
        return home_dir().ok_or_else(|| "Could not resolve home directory.".to_string());
    }

    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| "Could not resolve home directory.".to_string());
    }

    Ok(PathBuf::from(path))
}

pub(crate) fn clean_required(value: &str, field_name: &str) -> Result<String, String> {
    clean_optional(value).ok_or_else(|| format!("{field_name} is required."))
}

pub(crate) fn clean_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn clean_optional_string(value: &Option<String>) -> Option<String> {
    value.as_deref().and_then(clean_optional)
}

pub(crate) fn normalize_git_path(repo_path: &Path, path: &str) -> String {
    let parsed = PathBuf::from(path);
    if parsed.is_absolute() {
        parsed.to_string_lossy().to_string()
    } else {
        repo_path.join(parsed).to_string_lossy().to_string()
    }
}

pub(crate) fn repository_name(common_dir: &str) -> String {
    let path = Path::new(common_dir);
    if path.file_name().and_then(|name| name.to_str()) == Some(".git") {
        return path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or(common_dir)
            .to_string();
    }

    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or(common_dir)
        .to_string()
}

pub(crate) fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub(crate) async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
