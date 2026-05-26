//! 应用更新逻辑：检测 GitHub Release 并桥接 Tauri updater 安装句柄。
use std::{cmp::Ordering, time::Duration};

use reqwest::blocking::Client;
use semver::Version;
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

use crate::{
    common::run_blocking,
    models::{InstallableUpdateMetadata, ReleaseCheckResult},
};

pub(crate) const UPDATE_MENU_ID: &str = "app.check-for-updates";
pub(crate) const UPDATE_MENU_EVENT: &str = "app://check-for-updates";

const UPDATE_REPOSITORY_OWNER: &str = "HelloWorldImJoe";
// 自动更新仍从当前 GitHub 仓库读取 release；这里是仓库 slug，不是应用展示名。
const UPDATE_REPOSITORY_NAME: &str = "WorkTreeDesk";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReleaseChannel {
    Stable,
    Preview,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseResponse {
    html_url: String,
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command]
pub(crate) async fn check_for_app_update(
    app: tauri::AppHandle,
) -> Result<ReleaseCheckResult, String> {
    run_blocking(move || check_for_app_update_sync(app)).await
}

fn check_for_app_update_sync(app: tauri::AppHandle) -> Result<ReleaseCheckResult, String> {
    let package_version = app.package_info().version.to_string();
    let channel = current_release_channel(&package_version);
    let current_version = normalize_release_version(&package_version);
    let release = fetch_latest_github_release(channel)?;
    let latest_version = normalize_release_version(&release.tag_name);
    let has_update = compare_versions(&latest_version, &current_version)
        .map(|ordering| ordering.is_gt())
        .unwrap_or_else(|| latest_version != current_version);
    let updater_manifest_url = updater_manifest_url(&release);

    Ok(ReleaseCheckResult {
        current_version,
        latest_version,
        has_update,
        release_name: release.name,
        release_notes: release.body,
        published_at: release.published_at,
        release_page_url: release.html_url,
        updater_manifest_url,
    })
}

#[tauri::command]
pub(crate) async fn check_for_installable_app_update<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    manifest_url: String,
) -> Result<Option<InstallableUpdateMetadata>, String> {
    let manifest_url = tauri::Url::parse(&manifest_url)
        .map_err(|error| format!("Invalid updater manifest URL: {error}"))?;

    // 优先使用 GitHub Release 自带的 latest.json 资产创建安装句柄，
    // 避免 updater 分支清单同步延迟时只能打开发布页。
    let updater = webview
        .updater_builder()
        .endpoints(vec![manifest_url])
        .map_err(|error| format!("Failed to configure updater endpoint: {error}"))?
        .version_comparator(|current, update| update.version != current)
        .build()
        .map_err(|error| format!("Failed to initialize updater: {error}"))?;

    let update = updater
        .check()
        .await
        .map_err(|error| format!("Failed to check installable update: {error}"))?;

    let Some(update) = update else {
        return Ok(None);
    };

    let date = match update.date {
        Some(date) => Some(date.to_string()),
        None => None,
    };

    let metadata = InstallableUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        date,
        rid: webview.resources_table().add(update),
    };

    Ok(Some(metadata))
}

fn current_release_channel(version: &str) -> ReleaseChannel {
    match option_env!("WORKFLOWSTUDIO_CHANNEL") {
        Some("preview") => ReleaseChannel::Preview,
        Some(_) => ReleaseChannel::Stable,
        None if normalize_release_version(version).contains("-preview.") => ReleaseChannel::Preview,
        None => ReleaseChannel::Stable,
    }
}

fn fetch_latest_github_release(channel: ReleaseChannel) -> Result<GithubReleaseResponse, String> {
    match channel {
        ReleaseChannel::Stable => fetch_latest_stable_release(),
        ReleaseChannel::Preview => fetch_latest_preview_release(),
    }
}

fn updater_manifest_url(release: &GithubReleaseResponse) -> Option<String> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == "latest.json")
        .map(|asset| asset.browser_download_url.clone())
}

fn fetch_latest_stable_release() -> Result<GithubReleaseResponse, String> {
    let client = github_client()?;
    let response = client
        .get(format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            UPDATE_REPOSITORY_OWNER, UPDATE_REPOSITORY_NAME
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "WorkFlowStudio-Updater")
        .send()
        .map_err(|error| format!("Failed to reach GitHub Releases: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("GitHub Releases returned HTTP {status}"));
    }

    let release: GithubReleaseResponse = response
        .json()
        .map_err(|error| format!("Failed to parse GitHub release response: {error}"))?;

    if release.draft {
        return Err("Latest GitHub release is still a draft".into());
    }

    if release.prerelease {
        return Err("Latest GitHub release is a prerelease".into());
    }

    Ok(release)
}

fn fetch_latest_preview_release() -> Result<GithubReleaseResponse, String> {
    let client = github_client()?;
    let response = client
        .get(format!(
            "https://api.github.com/repos/{}/{}/releases",
            UPDATE_REPOSITORY_OWNER, UPDATE_REPOSITORY_NAME
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "WorkFlowStudio-Updater")
        .query(&[("per_page", "20")])
        .send()
        .map_err(|error| format!("Failed to reach GitHub Releases: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("GitHub Releases returned HTTP {status}"));
    }

    let releases: Vec<GithubReleaseResponse> = response
        .json()
        .map_err(|error| format!("Failed to parse GitHub release response: {error}"))?;

    releases
        .into_iter()
        .find(|release| !release.draft)
        .ok_or_else(|| "Could not find a published GitHub release for preview channel.".to_string())
}

fn github_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Failed to create update client: {error}"))
}

fn normalize_release_version(value: &str) -> String {
    value.trim().trim_start_matches('v').to_string()
}

fn compare_versions(left: &str, right: &str) -> Option<Ordering> {
    let left = Version::parse(left).ok()?;
    let right = Version::parse(right).ok()?;
    Some(left.cmp(&right))
}
