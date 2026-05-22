use crate::{
    common::expand_home,
    models::{
        CodeReviewResult, GiteeCodeReviewRequest, GiteePullRequestActionRequest,
        GiteePullRequestDetailRequest, GiteePullRequestListRequest, PullRequestChangedFileInfo,
        PullRequestCommitInfo, PullRequestInfo, PullRequestPage, RepositoryInfo,
        RepositoryMemberInfo,
        ReviewProviderKind, ReviewProviderListRequest, ReviewProviderPullRequestRequest,
    },
    provider::require_review_provider,
};

use super::{gitee, github, gitlab, shared::require_provider_access_token};

/// 统一的评审命令入口。
///
/// 前端只调用这一组标准命令，后端再根据仓库识别到的 provider 分发到 Gitee、GitHub
/// 或 GitLab 的具体实现，避免 UI 层关心平台差异。
#[tauri::command]
pub(crate) fn list_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<PullRequestPage, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;
    let state = request.state.as_deref().unwrap_or("open");
    let page = request.page.unwrap_or(1).max(1);
    let per_page = request.per_page.unwrap_or(10).max(1);

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::list_gitee_pull_requests(request),
        ReviewProviderKind::Github => {
            github::list_github_pull_requests_by_state(&provider, &access_token, state, page, per_page)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::list_gitlab_merge_requests_by_state(&provider, &access_token, state, page, per_page)
        }
    }
}

#[tauri::command]
pub(crate) fn count_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<u64, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;
    let state = request.state.as_deref().unwrap_or("open");

    match provider.kind {
        ReviewProviderKind::Gitee => {
            let repo = crate::provider::require_gitee_repository(&repo_path)?;
            gitee::count_gitee_pull_requests(&repo, &access_token, state)
        }
        ReviewProviderKind::Github => github::count_github_pull_requests(&provider, &access_token, state),
        ReviewProviderKind::Gitlab => gitlab::count_gitlab_merge_requests(&provider, &access_token, state),
    }
}

#[tauri::command]
pub(crate) fn get_pull_request_detail(
    request: GiteePullRequestDetailRequest,
) -> Result<PullRequestInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::get_gitee_pull_request_detail(request),
        ReviewProviderKind::Github => {
            github::get_github_pull_request_detail(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::get_gitlab_merge_request_detail(&provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) fn approve_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::approve_gitee_pull_request_review(request),
        ReviewProviderKind::Github => {
            github::approve_github_pull_request_review(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::approve_gitlab_merge_request_review(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) fn approve_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::approve_gitee_pull_request_test(request),
        ReviewProviderKind::Github | ReviewProviderKind::Gitlab => Err(format!(
            "{} does not expose a supported manual test-pass API for this workflow.",
            provider.display_name
        )),
    }
}

#[tauri::command]
pub(crate) fn reset_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::reset_gitee_pull_request_review(request),
        ReviewProviderKind::Github => Err(
            "GitHub review approval reset is not supported by this workflow.".to_string(),
        ),
        ReviewProviderKind::Gitlab => {
            gitlab::reset_gitlab_merge_request_review(&repo_path, &provider, &request)
        }
    }
}

#[tauri::command]
pub(crate) fn reset_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::reset_gitee_pull_request_test(request),
        ReviewProviderKind::Github | ReviewProviderKind::Gitlab => Err(format!(
            "{} does not expose a supported manual test reset API for this workflow.",
            provider.display_name
        )),
    }
}

#[tauri::command]
pub(crate) fn reopen_pull_request(
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
pub(crate) fn close_pull_request(
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
pub(crate) fn merge_pull_request(
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
pub(crate) fn list_pull_request_commits(
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
pub(crate) fn list_pull_request_files(
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
pub(crate) fn list_repository_members(
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

#[tauri::command]
pub(crate) fn prepare_code_review(
    request: GiteeCodeReviewRequest,
) -> Result<CodeReviewResult, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::prepare_gitee_code_review(request),
        ReviewProviderKind::Github => {
            github::prepare_github_code_review(&repo_path, &provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::prepare_gitlab_code_review(&repo_path, &provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) fn cleanup_code_review_worktree(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => gitee::cleanup_gitee_code_review_worktree(request),
        ReviewProviderKind::Github => {
            github::cleanup_github_code_review_worktree(&repo_path, &provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            gitlab::cleanup_gitlab_code_review_worktree(&repo_path, &provider, &access_token, request.number)
        }
    }
}