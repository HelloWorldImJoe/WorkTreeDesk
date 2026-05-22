use std::{path::Path, process::Command};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::{
    common::{expand_home, run_blocking},
    git::run_git,
    models::{
        CodeReviewResult, GiteeCodeReviewRequest, GiteePullRequestActionRequest,
        GiteePullRequestDetailRequest, GiteePullRequestListRequest, PullRequestChangedFileInfo,
        PullRequestCommitInfo, PullRequestFileContent, PullRequestFilePreview, PullRequestInfo,
        PullRequestPage, RepositoryInfo, RepositoryMemberInfo, ReviewProviderKind,
        ReviewProviderListRequest, ReviewProviderPullRequestFileRequest,
        ReviewProviderPullRequestRequest,
    },
    provider::require_review_provider,
};

use super::{gitee, github, gitlab, shared::require_provider_access_token};

/// 统一的评审命令入口。
///
/// 前端只调用这一组标准命令，后端再根据仓库识别到的 provider 分发到 Gitee、GitHub
/// 或 GitLab 的具体实现，避免 UI 层关心平台差异。
#[tauri::command]
pub(crate) async fn list_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<PullRequestPage, String> {
    run_blocking(move || list_pull_requests_sync(request)).await
}

fn list_pull_requests_sync(
    request: GiteePullRequestListRequest,
) -> Result<PullRequestPage, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;
    let state = request.state.as_deref().unwrap_or("open");
    let page = request.page.unwrap_or(1).max(1);
    let per_page = request.per_page.unwrap_or(20).max(1);

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::list_gitee_pull_requests_sync(request),
        ReviewProviderKind::Github => github::list_github_pull_requests_by_state(
            &provider,
            &access_token,
            state,
            page,
            per_page,
        ),
        ReviewProviderKind::Gitlab => gitlab::list_gitlab_merge_requests_by_state(
            &provider,
            &access_token,
            state,
            page,
            per_page,
        ),
    }
}

#[tauri::command]
pub(crate) async fn count_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<u64, String> {
    run_blocking(move || count_pull_requests_sync(request)).await
}

fn count_pull_requests_sync(request: GiteePullRequestListRequest) -> Result<u64, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;
    let state = request.state.as_deref().unwrap_or("open");

    match provider.kind {
        ReviewProviderKind::Gitee => {
            let repo = crate::provider::require_gitee_repository(&repo_path)?;
            gitee::count_gitee_pull_requests(&repo, &access_token, state)
        }
        ReviewProviderKind::Github => {
            github::count_github_pull_requests(&provider, &access_token, state)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::count_gitlab_merge_requests(&provider, &access_token, state)
        }
    }
}

#[tauri::command]
pub(crate) async fn get_pull_request_detail(
    request: GiteePullRequestDetailRequest,
) -> Result<PullRequestInfo, String> {
    run_blocking(move || get_pull_request_detail_sync(request)).await
}

fn get_pull_request_detail_sync(
    request: GiteePullRequestDetailRequest,
) -> Result<PullRequestInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::get_gitee_pull_request_detail_sync(request),
        ReviewProviderKind::Github => {
            github::get_github_pull_request_detail(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::get_gitlab_merge_request_detail(&provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) async fn approve_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || approve_pull_request_review_sync(request)).await
}

fn approve_pull_request_review_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::approve_gitee_pull_request_review_sync(request),
        ReviewProviderKind::Github => {
            github::approve_github_pull_request_review(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::approve_gitlab_merge_request_review(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) async fn approve_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || approve_pull_request_test_sync(request)).await
}

fn approve_pull_request_test_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::approve_gitee_pull_request_test_sync(request),
        ReviewProviderKind::Github | ReviewProviderKind::Gitlab => Err(format!(
            "{} does not expose a supported manual test-pass API for this workflow.",
            provider.display_name
        )),
    }
}

#[tauri::command]
pub(crate) async fn reset_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || reset_pull_request_review_sync(request)).await
}

fn reset_pull_request_review_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::reset_gitee_pull_request_review_sync(request),
        ReviewProviderKind::Github => {
            Err("GitHub review approval reset is not supported by this workflow.".to_string())
        }
        ReviewProviderKind::Gitlab => {
            gitlab::reset_gitlab_merge_request_review(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) async fn reset_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || reset_pull_request_test_sync(request)).await
}

fn reset_pull_request_test_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::reset_gitee_pull_request_test_sync(request),
        ReviewProviderKind::Github | ReviewProviderKind::Gitlab => Err(format!(
            "{} does not expose a supported manual test reset API for this workflow.",
            provider.display_name
        )),
    }
}

#[tauri::command]
pub(crate) async fn reopen_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || reopen_pull_request_sync(request)).await
}

fn reopen_pull_request_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::reopen_gitee_pull_request(request),
        ReviewProviderKind::Github => {
            github::reopen_github_pull_request(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::reopen_gitlab_merge_request(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) async fn close_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || close_pull_request_sync(request)).await
}

fn close_pull_request_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::close_gitee_pull_request(request),
        ReviewProviderKind::Github => {
            github::close_github_pull_request(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::close_gitlab_merge_request(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) async fn merge_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || merge_pull_request_sync(request)).await
}

fn merge_pull_request_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::merge_gitee_pull_request(request),
        ReviewProviderKind::Github => {
            github::merge_github_pull_request(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::merge_gitlab_merge_request(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) async fn list_pull_request_commits(
    request: ReviewProviderPullRequestRequest,
) -> Result<Vec<PullRequestCommitInfo>, String> {
    run_blocking(move || list_pull_request_commits_sync(request)).await
}

fn list_pull_request_commits_sync(
    request: ReviewProviderPullRequestRequest,
) -> Result<Vec<PullRequestCommitInfo>, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => {
            gitee::list_gitee_pull_request_commits(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Github => {
            github::list_github_pull_request_commits(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::list_gitlab_pull_request_commits(&provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) async fn list_pull_request_files(
    request: ReviewProviderPullRequestRequest,
) -> Result<Vec<PullRequestChangedFileInfo>, String> {
    run_blocking(move || list_pull_request_files_sync(request)).await
}

fn list_pull_request_files_sync(
    request: ReviewProviderPullRequestRequest,
) -> Result<Vec<PullRequestChangedFileInfo>, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => {
            gitee::list_gitee_pull_request_files(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Github => {
            github::list_github_pull_request_files(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::list_gitlab_pull_request_files(&provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) async fn get_pull_request_file_content(
    request: ReviewProviderPullRequestFileRequest,
) -> Result<PullRequestFileContent, String> {
    run_blocking(move || get_pull_request_file_content_sync(request)).await
}

fn get_pull_request_file_content_sync(
    request: ReviewProviderPullRequestFileRequest,
) -> Result<PullRequestFileContent, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let _access_token = require_provider_access_token(&request.access_token, &provider)?;
    let detail = get_pull_request_detail_sync(ReviewProviderPullRequestRequest {
        repo_path: request.repo_path.clone(),
        access_token: request.access_token.clone(),
        number: request.number,
    })?;
    let source_branch = detail.source_branch.as_deref();
    let target_branch = detail.target_branch.as_deref();
    let patch = source_branch
        .zip(target_branch)
        .and_then(|(source, target)| {
            find_file_patch(
                &repo_path,
                &provider.remote_name,
                source,
                target,
                &request.filename,
            )
        });
    let image_preview = if is_previewable_image(&request.filename) {
        source_branch
            .and_then(|source| {
                find_file_blob(&repo_path, &provider.remote_name, source, &request.filename)
            })
            .or_else(|| {
                target_branch.and_then(|target| {
                    find_file_blob(&repo_path, &provider.remote_name, target, &request.filename)
                })
            })
            .and_then(|bytes| build_image_preview(&request.filename, bytes).ok())
    } else {
        None
    };
    let binary = image_preview.is_some()
        || patch.as_deref().is_some_and(|value| {
            value.contains("Binary files") || value.contains("GIT binary patch")
        });
    let message = if patch
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        None
    } else if image_preview.is_some() {
        Some("图片文件没有文本差异，可查看预览。".to_string())
    } else {
        Some("未能从远端或本地 Git 引用中生成此文件的文本差异。".to_string())
    };

    Ok(PullRequestFileContent {
        filename: request.filename,
        patch,
        image_preview,
        binary,
        message,
    })
}

#[tauri::command]
pub(crate) async fn list_repository_members(
    request: ReviewProviderListRequest,
) -> Result<Vec<RepositoryMemberInfo>, String> {
    run_blocking(move || list_repository_members_sync(request)).await
}

fn list_repository_members_sync(
    request: ReviewProviderListRequest,
) -> Result<Vec<RepositoryMemberInfo>, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::list_gitee_repository_members(&provider, &access_token),
        ReviewProviderKind::Github => {
            github::list_github_repository_members(&provider, &access_token)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::list_gitlab_repository_members(&provider, &access_token)
        }
    }
}

fn find_file_patch(
    repo_path: &Path,
    remote_name: &str,
    source_branch: &str,
    target_branch: &str,
    filename: &str,
) -> Option<String> {
    let source_refs = ref_candidates(remote_name, source_branch);
    let target_refs = ref_candidates(remote_name, target_branch);

    for target_ref in &target_refs {
        for source_ref in &source_refs {
            if let Ok(diff) = git_file_diff(repo_path, target_ref, source_ref, filename, true) {
                if !diff.trim().is_empty() {
                    return Some(diff);
                }
            }
            if let Ok(diff) = git_file_diff(repo_path, target_ref, source_ref, filename, false) {
                if !diff.trim().is_empty() {
                    return Some(diff);
                }
            }
        }
    }

    None
}

fn git_file_diff(
    repo_path: &Path,
    target_ref: &str,
    source_ref: &str,
    filename: &str,
    merge_base: bool,
) -> Result<String, String> {
    let range = if merge_base {
        format!("{target_ref}...{source_ref}")
    } else {
        format!("{target_ref}..{source_ref}")
    };

    run_git(
        repo_path,
        &[
            "diff".to_string(),
            "--no-ext-diff".to_string(),
            "--find-renames".to_string(),
            "--unified=80".to_string(),
            range,
            "--".to_string(),
            filename.to_string(),
        ],
    )
}

fn find_file_blob(
    repo_path: &Path,
    remote_name: &str,
    branch: &str,
    filename: &str,
) -> Option<Vec<u8>> {
    for reference in ref_candidates(remote_name, branch) {
        let object = format!("{reference}:{filename}");
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("show")
            .arg(object)
            .output()
            .ok()?;

        if output.status.success() && !output.stdout.is_empty() {
            return Some(output.stdout);
        }
    }

    None
}

fn ref_candidates(remote_name: &str, branch: &str) -> Vec<String> {
    let branch = branch.trim().trim_start_matches("refs/heads/");
    let mut candidates = vec![branch.to_string()];

    if !branch.starts_with(&format!("{remote_name}/")) {
        candidates.push(format!("{remote_name}/{branch}"));
        candidates.push(format!("refs/remotes/{remote_name}/{branch}"));
    }

    candidates.push(format!("refs/heads/{branch}"));
    candidates
}

fn is_previewable_image(filename: &str) -> bool {
    image_mime_type(filename).is_some()
}

fn image_mime_type(filename: &str) -> Option<&'static str> {
    let extension = filename.rsplit('.').next()?.to_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn build_image_preview(filename: &str, bytes: Vec<u8>) -> Result<PullRequestFilePreview, String> {
    const MAX_PREVIEW_BYTES: usize = 4 * 1024 * 1024;

    if bytes.len() > MAX_PREVIEW_BYTES {
        return Err("Image is too large to preview inline.".to_string());
    }

    let mime_type = image_mime_type(filename)
        .ok_or_else(|| "Unsupported image preview type.".to_string())?
        .to_string();
    let data_url = format!("data:{mime_type};base64,{}", STANDARD.encode(&bytes));

    Ok(PullRequestFilePreview {
        mime_type,
        data_url,
        size: bytes.len(),
    })
}

#[tauri::command]
pub(crate) async fn prepare_code_review(
    request: GiteeCodeReviewRequest,
) -> Result<CodeReviewResult, String> {
    run_blocking(move || prepare_code_review_sync(request)).await
}

fn prepare_code_review_sync(request: GiteeCodeReviewRequest) -> Result<CodeReviewResult, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::prepare_gitee_code_review_sync(request),
        ReviewProviderKind::Github => {
            github::prepare_github_code_review(&repo_path, &provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::prepare_gitlab_code_review(&repo_path, &provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) async fn cleanup_code_review_worktree(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || cleanup_code_review_worktree_sync(request)).await
}

fn cleanup_code_review_worktree_sync(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::cleanup_gitee_code_review_worktree_sync(request),
        ReviewProviderKind::Github => github::cleanup_github_code_review_worktree(
            &repo_path,
            &provider,
            &access_token,
            request.number,
        ),
        ReviewProviderKind::Gitlab => gitlab::cleanup_gitlab_code_review_worktree(
            &repo_path,
            &provider,
            &access_token,
            request.number,
        ),
    }
}
