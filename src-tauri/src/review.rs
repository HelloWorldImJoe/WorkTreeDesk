use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{
    common::{clean_optional, clean_required, expand_home, path_arg},
    git::{list_git_remotes, run_git},
    models::{
        CodeReviewResult, GiteeCodeReviewRequest, GiteeGitAuth, GiteePullRequestActionRequest,
        GiteePullRequestDetailRequest, GiteePullRequestInfo, GiteePullRequestListRequest,
        GiteeRepositoryInfo, GitHttpAuth, PullRequestBranchRef, PullRequestInfo,
        RepositoryInfo, ReviewProviderInfo, ReviewProviderKind,
    },
    provider::{
        find_remote_name_for_repo, is_gitee_https_url, is_provider_https_url,
        require_gitee_repository, require_review_provider,
    },
    repository::inspect_repository,
};

#[tauri::command]
pub(crate) fn list_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<Vec<PullRequestInfo>, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let provider = require_review_provider(&repo_path)?;
    let access_token = require_provider_access_token(&request.access_token, &provider)?;

    match provider.kind {
        ReviewProviderKind::Gitee => list_gitee_pull_requests(request),
        ReviewProviderKind::Github => list_github_pull_requests(&provider, &access_token),
        ReviewProviderKind::Gitlab => list_gitlab_merge_requests(&provider, &access_token),
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
        ReviewProviderKind::Gitee => get_gitee_pull_request_detail(request),
        ReviewProviderKind::Github => {
            get_github_pull_request_detail(&provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            get_gitlab_merge_request_detail(&provider, &access_token, request.number)
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
        ReviewProviderKind::Gitee => approve_gitee_pull_request_review(request),
        ReviewProviderKind::Github => {
            approve_github_pull_request_review(&repo_path, &provider, &request)
        }
        ReviewProviderKind::Gitlab => {
            approve_gitlab_merge_request_review(&repo_path, &provider, &request)
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
        ReviewProviderKind::Gitee => approve_gitee_pull_request_test(request),
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
        ReviewProviderKind::Gitee => reset_gitee_pull_request_review(request),
        ReviewProviderKind::Github => Err(
            "GitHub review approval reset is not supported by this workflow.".to_string(),
        ),
        ReviewProviderKind::Gitlab => {
            reset_gitlab_merge_request_review(&repo_path, &provider, &request)
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
        ReviewProviderKind::Gitee => reset_gitee_pull_request_test(request),
        ReviewProviderKind::Github | ReviewProviderKind::Gitlab => Err(format!(
            "{} does not expose a supported manual test reset API for this workflow.",
            provider.display_name
        )),
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
        ReviewProviderKind::Gitee => prepare_gitee_code_review(request),
        ReviewProviderKind::Github => {
            prepare_github_code_review(&repo_path, &provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            prepare_gitlab_code_review(&repo_path, &provider, &access_token, request.number)
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
        ReviewProviderKind::Gitee => cleanup_gitee_code_review_worktree(request),
        ReviewProviderKind::Github => {
            cleanup_github_code_review_worktree(&repo_path, &provider, &access_token, request.number)
        }
        ReviewProviderKind::Gitlab => {
            cleanup_gitlab_code_review_worktree(&repo_path, &provider, &access_token, request.number)
        }
    }
}

#[tauri::command]
pub(crate) fn list_gitee_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<Vec<GiteePullRequestInfo>, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = gitee_get(
        &access_token,
        &format!("/repos/{}/{}/pulls", repo.owner, repo.repo),
        vec![
            ("state".to_string(), "open".to_string()),
            ("sort".to_string(), "created".to_string()),
            ("direction".to_string(), "desc".to_string()),
            ("page".to_string(), "1".to_string()),
            ("per_page".to_string(), "100".to_string()),
        ],
    )?;

    let entries = response
        .as_array()
        .ok_or_else(|| "Unexpected Gitee PR list response.".to_string())?;

    entries
        .iter()
        .map(|entry| map_gitee_pull_request(entry, &repo))
        .collect()
}

#[tauri::command]
pub(crate) fn get_gitee_pull_request_detail(
    request: GiteePullRequestDetailRequest,
) -> Result<GiteePullRequestInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = fetch_gitee_pull_request_value(&repo, &access_token, request.number)?;

    map_gitee_pull_request(&response, &repo)
}

#[tauri::command]
pub(crate) fn approve_gitee_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}/review", repo.owner, repo.repo, request.number),
        vec![
            ("action".to_string(), "approve".to_string()),
            ("event".to_string(), "approve".to_string()),
            ("state".to_string(), "approved".to_string()),
        ],
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn approve_gitee_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}/test", repo.owner, repo.repo, request.number),
        vec![
            ("action".to_string(), "pass".to_string()),
            ("event".to_string(), "pass".to_string()),
            ("state".to_string(), "passed".to_string()),
        ],
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn reset_gitee_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!(
            "/repos/{}/{}/pulls/{}/review/reset",
            repo.owner, repo.repo, request.number
        ),
        Vec::new(),
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn reset_gitee_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!(
            "/repos/{}/{}/pulls/{}/test/reset",
            repo.owner, repo.repo, request.number
        ),
        Vec::new(),
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn prepare_gitee_code_review(
    request: GiteeCodeReviewRequest,
) -> Result<CodeReviewResult, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = fetch_gitee_pull_request_value(&repo, &access_token, request.number)?;
    let base = extract_pull_request_branch_ref(&response, "base")?;
    let head = extract_pull_request_branch_ref(&response, "head")?;
    let code_review_root = code_review_root(&repo_path)?;
    let worktree_name = code_review_worktree_name(&base.branch, &head.branch);
    let worktree_path = code_review_root.join(worktree_name);
    let review_branch = code_review_branch_name(&base.branch, &head.branch, request.number);
    let base_ref = format!("refs/worktree-desk/base/pr-{}", request.number);
    let head_ref = format!("refs/worktree-desk/head/pr-{}", request.number);
    let base_source = resolve_fetch_source(&repo_path, &base, &repo)?;
    let head_source = resolve_fetch_source(&repo_path, &head, &repo)?;
    let git_auth = if fetch_source_uses_gitee_https(&repo_path, &base_source)
        || fetch_source_uses_gitee_https(&repo_path, &head_source)
    {
        Some(fetch_gitee_git_auth(&access_token)?)
    } else {
        None
    };

    prepare_review_worktree(
        &repo_path,
        &code_review_root,
        &worktree_path,
        &review_branch,
        &base_source,
        &base.branch,
        &base_ref,
        &head_source,
        &head.branch,
        &head_ref,
        git_auth.as_ref(),
    )?;

    Ok(CodeReviewResult {
        worktree_path: path_arg(&worktree_path),
        review_branch,
        web_url: extract_pull_request_web_url(&response)
            .unwrap_or_else(|| format!("{}/pulls/{}", repo.web_url, request.number)),
    })
}

#[tauri::command]
pub(crate) fn cleanup_gitee_code_review_worktree(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = fetch_gitee_pull_request_value(&repo, &access_token, request.number)?;

    cleanup_gitee_code_review(&repo_path, request.number, &response)?;

    inspect_repository(&repo_path)
}

fn list_github_pull_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Vec<PullRequestInfo>, String> {
    let response = github_get(
        access_token,
        &format!("/repos/{}/{}/pulls", provider.owner, provider.repo),
        vec![
            ("state".to_string(), "open".to_string()),
            ("sort".to_string(), "updated".to_string()),
            ("direction".to_string(), "desc".to_string()),
            ("per_page".to_string(), "100".to_string()),
        ],
    )?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitHub pull request response.".to_string())?
        .iter()
        .map(|entry| map_github_pull_request(entry, provider, None, None, None, None))
        .collect()
}

fn get_github_pull_request_detail(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<PullRequestInfo, String> {
    let response = github_get(
        access_token,
        &format!("/repos/{}/{}/pulls/{number}", provider.owner, provider.repo),
        Vec::new(),
    )?;
    let current_login = github_current_user_login(access_token)?;
    let review_status = github_current_user_review_status(provider, access_token, number)?;
    let test_status = github_pull_request_test_status(provider, access_token, &response)?;
    let (review_action_allowed, review_action_blocked_reason) =
        github_review_action_state(&response, current_login.as_deref());

    map_github_pull_request(
        &response,
        provider,
        review_status,
        test_status,
        review_action_allowed,
        review_action_blocked_reason,
    )
}

fn approve_github_pull_request_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    let current_login = github_current_user_login(&access_token)?;
    let pull_request = github_get(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}", provider.owner, provider.repo, request.number),
        Vec::new(),
    )?;
    let (review_action_allowed, review_action_blocked_reason) =
        github_review_action_state(&pull_request, current_login.as_deref());

    if review_action_allowed == Some(false) {
        return Err(
            review_action_blocked_reason
                .unwrap_or_else(|| "GitHub does not allow this review approval.".to_string()),
        );
    }

    github_post_json(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}/reviews", provider.owner, provider.repo, request.number),
        serde_json::json!({
            "event": "APPROVE"
        }),
    )?;

    inspect_repository(repo_path)
}

fn prepare_github_code_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<CodeReviewResult, String> {
    let response = github_get(
        access_token,
        &format!("/repos/{}/{}/pulls/{number}", provider.owner, provider.repo),
        Vec::new(),
    )?;
    let base = extract_pull_request_branch_ref(&response, "base")?;
    let head = extract_pull_request_branch_ref(&response, "head")?;

    prepare_provider_code_review(
        repo_path,
        provider,
        number,
        &response,
        base,
        head,
        access_token,
    )
}

fn cleanup_github_code_review_worktree(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<RepositoryInfo, String> {
    let response = github_get(
        access_token,
        &format!("/repos/{}/{}/pulls/{number}", provider.owner, provider.repo),
        Vec::new(),
    )?;
    let base = extract_pull_request_branch_ref(&response, "base")?;
    let head = extract_pull_request_branch_ref(&response, "head")?;
    cleanup_code_review_worktree_for_refs(repo_path, number, &base.branch, &head.branch)?;

    inspect_repository(repo_path)
}

fn list_gitlab_merge_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Vec<PullRequestInfo>, String> {
    let response = gitlab_get(
        provider,
        access_token,
        &format!("/projects/{}/merge_requests", encode_gitlab_project_path(&provider.full_name)),
        vec![
            ("state".to_string(), "opened".to_string()),
            ("order_by".to_string(), "updated_at".to_string()),
            ("sort".to_string(), "desc".to_string()),
            ("per_page".to_string(), "100".to_string()),
        ],
    )?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitLab merge request response.".to_string())?
        .iter()
        .map(|entry| {
            let test_status =
                first_string(entry, &[&["head_pipeline", "status"], &["pipeline", "status"]]);
            map_gitlab_merge_request(entry, provider, None, test_status)
        })
        .collect()
}

fn get_gitlab_merge_request_detail(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<PullRequestInfo, String> {
    let response = gitlab_get(
        provider,
        access_token,
        &format!(
            "/projects/{}/merge_requests/{number}",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )?;
    let review_status = gitlab_current_user_review_status(provider, access_token, number)?;
    let test_status =
        first_string(&response, &[&["head_pipeline", "status"], &["pipeline", "status"]]);

    map_gitlab_merge_request(&response, provider, review_status, test_status)
}

fn approve_gitlab_merge_request_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_post(
        provider,
        &access_token,
        &format!(
            "/projects/{}/merge_requests/{}/approve",
            encode_gitlab_project_path(&provider.full_name),
            request.number
        ),
    )?;

    inspect_repository(repo_path)
}

fn reset_gitlab_merge_request_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_post(
        provider,
        &access_token,
        &format!(
            "/projects/{}/merge_requests/{}/unapprove",
            encode_gitlab_project_path(&provider.full_name),
            request.number
        ),
    )?;

    inspect_repository(repo_path)
}

fn prepare_gitlab_code_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<CodeReviewResult, String> {
    let response = gitlab_get(
        provider,
        access_token,
        &format!(
            "/projects/{}/merge_requests/{number}",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )?;
    let (base, head) = extract_gitlab_merge_request_branch_refs(provider, access_token, &response)?;

    prepare_provider_code_review(
        repo_path,
        provider,
        number,
        &response,
        base,
        head,
        access_token,
    )
}

fn cleanup_gitlab_code_review_worktree(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<RepositoryInfo, String> {
    let response = gitlab_get(
        provider,
        access_token,
        &format!(
            "/projects/{}/merge_requests/{number}",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )?;
    let (base, head) = extract_gitlab_merge_request_branch_refs(provider, access_token, &response)?;
    cleanup_code_review_worktree_for_refs(repo_path, number, &base.branch, &head.branch)?;

    inspect_repository(repo_path)
}

fn prepare_provider_code_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    number: i64,
    response: &Value,
    base: PullRequestBranchRef,
    head: PullRequestBranchRef,
    access_token: &str,
) -> Result<CodeReviewResult, String> {
    let code_review_root = code_review_root(repo_path)?;
    let worktree_name = code_review_worktree_name(&base.branch, &head.branch);
    let worktree_path = code_review_root.join(worktree_name);
    let review_branch = code_review_branch_name(&base.branch, &head.branch, number);
    let base_ref = format!("refs/worktree-desk/base/pr-{number}");
    let head_ref = format!("refs/worktree-desk/head/pr-{number}");
    let base_source = resolve_fetch_source(repo_path, &base, provider)?;
    let head_source = resolve_fetch_source(repo_path, &head, provider)?;
    let git_auth = if fetch_source_uses_provider_https(repo_path, &base_source, provider)
        || fetch_source_uses_provider_https(repo_path, &head_source, provider)
    {
        Some(fetch_provider_git_auth(provider, access_token)?)
    } else {
        None
    };

    prepare_review_worktree(
        repo_path,
        &code_review_root,
        &worktree_path,
        &review_branch,
        &base_source,
        &base.branch,
        &base_ref,
        &head_source,
        &head.branch,
        &head_ref,
        git_auth.as_ref(),
    )?;

    Ok(CodeReviewResult {
        worktree_path: path_arg(&worktree_path),
        review_branch,
        web_url: extract_pull_request_web_url(response)
            .unwrap_or_else(|| format!("{}/pulls/{number}", provider.web_url)),
    })
}

fn prepare_review_worktree(
    repo_path: &Path,
    code_review_root: &Path,
    worktree_path: &Path,
    review_branch: &str,
    base_source: &str,
    base_branch: &str,
    base_ref: &str,
    head_source: &str,
    head_branch: &str,
    head_ref: &str,
    git_auth: Option<&GitHttpAuth>,
) -> Result<(), String> {
    fs::create_dir_all(code_review_root).map_err(|error| {
        format!(
            "Could not create CodeReview directory {}: {error}",
            code_review_root.display()
        )
    })?;

    fetch_branch_to_ref(repo_path, base_source, base_branch, base_ref, git_auth)?;
    ensure_available_review_path(worktree_path)?;

    if is_git_worktree(worktree_path) {
        abort_merge_if_needed(worktree_path)?;
        run_git(
            worktree_path,
            &[
                "checkout".to_string(),
                "-B".to_string(),
                review_branch.to_string(),
                base_ref.to_string(),
            ],
        )?;
        run_git(
            worktree_path,
            &[
                "reset".to_string(),
                "--hard".to_string(),
                base_ref.to_string(),
            ],
        )?;
        run_git(worktree_path, &["clean".to_string(), "-fd".to_string()])?;
    } else {
        run_git(
            repo_path,
            &[
                "worktree".to_string(),
                "prune".to_string(),
                "--verbose".to_string(),
            ],
        )?;
        run_git(
            repo_path,
            &[
                "worktree".to_string(),
                "add".to_string(),
                "-B".to_string(),
                review_branch.to_string(),
                path_arg(worktree_path),
                base_ref.to_string(),
            ],
        )?;
        ensure_git_worktree(worktree_path)?;
    }

    fetch_branch_to_ref(repo_path, head_source, head_branch, head_ref, git_auth)?;
    merge_ref_without_staging(worktree_path, head_ref)
}

fn ensure_available_review_path(worktree_path: &Path) -> Result<(), String> {
    if !worktree_path.exists() || is_git_worktree(worktree_path) {
        return Ok(());
    }

    if is_empty_directory(worktree_path)? {
        fs::remove_dir(worktree_path).map_err(|error| {
            format!(
                "Could not remove empty CodeReview directory {}: {error}",
                worktree_path.display()
            )
        })?;
        return Ok(());
    }

    Err(format!(
        "CodeReview path already exists and is not a git worktree: {}",
        worktree_path.display()
    ))
}

fn map_github_pull_request(
    value: &Value,
    provider: &ReviewProviderInfo,
    review_status: Option<String>,
    test_status: Option<String>,
    review_action_allowed: Option<bool>,
    review_action_blocked_reason: Option<String>,
) -> Result<PullRequestInfo, String> {
    let number = first_i64(value, &[&["number"]])
        .ok_or_else(|| "GitHub pull request is missing its number.".to_string())?;

    Ok(PullRequestInfo {
        number,
        title: first_string(value, &[&["title"]]).unwrap_or_else(|| format!("PR #{number}")),
        body: first_string(value, &[&["body"]]),
        author: first_string(value, &[&["user", "login"], &["user", "name"]])
            .unwrap_or_else(|| "Unknown".to_string()),
        author_avatar: first_string(value, &[&["user", "avatar_url"]]),
        state: first_string(value, &[&["state"]]),
        created_at: first_string(value, &[&["created_at"]]),
        updated_at: first_string(value, &[&["updated_at"]]),
        web_url: extract_pull_request_web_url(value)
            .unwrap_or_else(|| format!("{}/pulls/{number}", provider.web_url)),
        source_branch: extract_branch_name(value, "head"),
        target_branch: extract_branch_name(value, "base"),
        source_repo: extract_repo_full_name(value, "head"),
        target_repo: extract_repo_full_name(value, "base"),
        review_status,
        test_status,
        review_action_allowed,
        review_action_blocked_reason,
    })
}

fn map_gitlab_merge_request(
    value: &Value,
    provider: &ReviewProviderInfo,
    review_status: Option<String>,
    test_status: Option<String>,
) -> Result<PullRequestInfo, String> {
    let number = first_i64(value, &[&["iid"], &["number"], &["id"]])
        .ok_or_else(|| "GitLab merge request is missing its IID.".to_string())?;

    Ok(PullRequestInfo {
        number,
        title: first_string(value, &[&["title"]]).unwrap_or_else(|| format!("MR !{number}")),
        body: first_string(value, &[&["description"], &["body"]]),
        author: first_string(value, &[&["author", "username"], &["author", "name"]])
            .unwrap_or_else(|| "Unknown".to_string()),
        author_avatar: first_string(value, &[&["author", "avatar_url"]]),
        state: first_string(value, &[&["state"]]),
        created_at: first_string(value, &[&["created_at"]]),
        updated_at: first_string(value, &[&["updated_at"]]),
        web_url: extract_pull_request_web_url(value)
            .unwrap_or_else(|| format!("{}/-/merge_requests/{number}", provider.web_url)),
        source_branch: first_string(value, &[&["source_branch"]]),
        target_branch: first_string(value, &[&["target_branch"]]),
        source_repo: first_string(
            value,
            &[
                &["source_project", "path_with_namespace"],
                &["references", "full"],
            ],
        ),
        target_repo: Some(provider.full_name.clone()),
        review_status,
        test_status,
        review_action_allowed: None,
        review_action_blocked_reason: None,
    })
}

fn github_current_user_review_status(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Option<String>, String> {
    let login = github_current_user_login(access_token)?.unwrap_or_default();
    if login.is_empty() {
        return Ok(None);
    }

    let reviews = github_get(
        access_token,
        &format!("/repos/{}/{}/pulls/{number}/reviews", provider.owner, provider.repo),
        vec![("per_page".to_string(), "100".to_string())],
    )?;

    let items = match reviews.as_array() {
        Some(items) => items,
        None => return Ok(None),
    };

    Ok(items.iter().rev().find_map(|entry| {
        let author = first_string(entry, &[&["user", "login"]])?;
        if author != login {
            return None;
        }
        first_string(entry, &[&["state"], &["event"]]).map(|state| state.to_lowercase())
    }))
}

fn github_current_user_login(access_token: &str) -> Result<Option<String>, String> {
    let user = github_get(access_token, "/user", Vec::new())?;
    Ok(first_string(&user, &[&["login"]]))
}

fn github_review_action_state(
    pull_request: &Value,
    current_login: Option<&str>,
) -> (Option<bool>, Option<String>) {
    let Some(current_login) = current_login.map(str::trim).filter(|login| !login.is_empty()) else {
        return (None, None);
    };

    let author_login = first_string(pull_request, &[&["user", "login"]]);
    let is_author = author_login
        .as_deref()
        .is_some_and(|author| author.eq_ignore_ascii_case(current_login));

    if is_author {
        return (
            Some(false),
            Some("GitHub does not allow approving your own pull request.".to_string()),
        );
    }

    (Some(true), None)
}

fn github_pull_request_test_status(
    provider: &ReviewProviderInfo,
    access_token: &str,
    value: &Value,
) -> Result<Option<String>, String> {
    let sha = match first_string(value, &[&["head", "sha"]]) {
        Some(sha) => sha,
        None => return Ok(None),
    };
    let status = github_get(
        access_token,
        &format!("/repos/{}/{}/commits/{sha}/status", provider.owner, provider.repo),
        Vec::new(),
    )?;

    Ok(first_string(&status, &[&["state"]]).map(|state| state.to_lowercase()))
}

fn gitlab_current_user_review_status(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Option<String>, String> {
    let user = gitlab_get(provider, access_token, "/user", Vec::new())?;
    let user_id = match first_i64(&user, &[&["id"]]) {
        Some(id) => id,
        None => return Ok(None),
    };
    let approvals = gitlab_get(
        provider,
        access_token,
        &format!(
            "/projects/{}/merge_requests/{number}/approvals",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )?;
    let approved = approvals
        .get("approved_by")
        .and_then(Value::as_array)
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                first_i64(entry, &[&["user", "id"], &["id"]]) == Some(user_id)
            })
        });

    Ok(if approved {
        Some("approved".to_string())
    } else {
        None
    })
}

fn extract_gitlab_merge_request_branch_refs(
    provider: &ReviewProviderInfo,
    access_token: &str,
    value: &Value,
) -> Result<(PullRequestBranchRef, PullRequestBranchRef), String> {
    let source_branch = first_string(value, &[&["source_branch"]])
        .ok_or_else(|| "GitLab merge request is missing source_branch.".to_string())?;
    let target_branch = first_string(value, &[&["target_branch"]])
        .ok_or_else(|| "GitLab merge request is missing target_branch.".to_string())?;
    let source_project = match first_i64(value, &[&["source_project_id"]]) {
        Some(id) => fetch_gitlab_project(provider, access_token, id).ok(),
        None => None,
    };
    let target_project = match first_i64(value, &[&["target_project_id"]]) {
        Some(id) => fetch_gitlab_project(provider, access_token, id).ok(),
        None => None,
    };

    let source_full_name = source_project
        .as_ref()
        .and_then(|project| first_string(project, &[&["path_with_namespace"]]))
        .unwrap_or_else(|| provider.full_name.clone());
    let target_full_name = target_project
        .as_ref()
        .and_then(|project| first_string(project, &[&["path_with_namespace"]]))
        .unwrap_or_else(|| provider.full_name.clone());
    let (source_owner, source_repo) = split_owner_repo(&source_full_name)
        .ok_or_else(|| format!("Could not parse GitLab source project path: {source_full_name}"))?;
    let (target_owner, target_repo) = split_owner_repo(&target_full_name)
        .ok_or_else(|| format!("Could not parse GitLab target project path: {target_full_name}"))?;

    Ok((
        PullRequestBranchRef {
            branch: normalize_branch_name(&target_branch),
            repo_owner: Some(target_owner),
            repo_name: Some(target_repo),
            clone_url: target_project
                .as_ref()
                .and_then(|project| first_string(project, &[&["http_url_to_repo"], &["web_url"]])),
        },
        PullRequestBranchRef {
            branch: normalize_branch_name(&source_branch),
            repo_owner: Some(source_owner),
            repo_name: Some(source_repo),
            clone_url: source_project
                .as_ref()
                .and_then(|project| first_string(project, &[&["http_url_to_repo"], &["web_url"]])),
        },
    ))
}

fn fetch_gitlab_project(
    provider: &ReviewProviderInfo,
    access_token: &str,
    project_id: i64,
) -> Result<Value, String> {
    gitlab_get(provider, access_token, &format!("/projects/{project_id}"), Vec::new())
}

fn encode_gitlab_project_path(project_path: &str) -> String {
    project_path.trim().trim_matches('/').replace('/', "%2F")
}

fn github_get(
    access_token: &str,
    path: &str,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    let client = api_client("GitHub")?;
    let response = client
        .get(format!("https://api.github.com{path}"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .query(&query)
        .send()
        .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

    parse_json_response_with_label("GitHub", response)
}

fn github_post_json(access_token: &str, path: &str, body: Value) -> Result<Value, String> {
    let client = api_client("GitHub")?;
    let response = client
        .post(format!("https://api.github.com{path}"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .json(&body)
        .send()
        .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

    parse_json_response_with_label("GitHub", response)
}

fn gitlab_get(
    provider: &ReviewProviderInfo,
    access_token: &str,
    path: &str,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    let client = api_client("GitLab")?;
    let response = client
        .get(format!("https://{}/api/v4{}", provider.host, path))
        .header("PRIVATE-TOKEN", access_token)
        .query(&query)
        .send()
        .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

    parse_json_response_with_label("GitLab", response)
}

fn gitlab_post(
    provider: &ReviewProviderInfo,
    access_token: &str,
    path: &str,
) -> Result<Value, String> {
    let client = api_client("GitLab")?;
    let response = client
        .post(format!("https://{}/api/v4{}", provider.host, path))
        .header("PRIVATE-TOKEN", access_token)
        .send()
        .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

    parse_json_response_with_label("GitLab", response)
}

fn map_gitee_pull_request(
    value: &Value,
    repo: &GiteeRepositoryInfo,
) -> Result<GiteePullRequestInfo, String> {
    let number = first_i64(
        value,
        &[&["number"], &["id"], &["iid"], &["pull_request_number"]],
    )
    .ok_or_else(|| "Gitee PR is missing its number.".to_string())?;
    let title = first_string(value, &[&["title"]]).unwrap_or_else(|| format!("PR #{number}"));
    let author = first_string(
        value,
        &[
            &["user", "name"],
            &["user", "login"],
            &["author", "name"],
            &["author", "login"],
            &["author", "nickname"],
        ],
    )
    .unwrap_or_else(|| "Unknown".to_string());

    Ok(GiteePullRequestInfo {
        number,
        title,
        body: first_string(value, &[&["body"], &["description"]]),
        author,
        author_avatar: first_string(
            value,
            &[
                &["user", "avatar_url"],
                &["author", "avatar_url"],
                &["author", "avatarUrl"],
            ],
        ),
        state: first_string(value, &[&["state"], &["status"]]),
        created_at: first_string(value, &[&["created_at"], &["createdAt"]]),
        updated_at: first_string(value, &[&["updated_at"], &["updatedAt"]]),
        web_url: extract_pull_request_web_url(value)
            .unwrap_or_else(|| format!("{}/pulls/{}", repo.web_url, number)),
        source_branch: extract_branch_name(value, "head"),
        target_branch: extract_branch_name(value, "base"),
        source_repo: extract_repo_full_name(value, "head"),
        target_repo: extract_repo_full_name(value, "base"),
        review_status: first_string(
            value,
            &[
                &["review_status"],
                &["reviewStatus"],
                &["review_state"],
                &["reviewState"],
            ],
        ),
        test_status: first_string(
            value,
            &[
                &["test_status"],
                &["testStatus"],
                &["test_state"],
                &["testState"],
            ],
        ),
        review_action_allowed: None,
        review_action_blocked_reason: None,
    })
}

fn fetch_gitee_pull_request_value(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    gitee_get(
        access_token,
        &format!("/repos/{}/{}/pulls/{}", repo.owner, repo.repo, number),
        Vec::new(),
    )
}

fn extract_pull_request_branch_ref(
    value: &Value,
    role: &str,
) -> Result<PullRequestBranchRef, String> {
    let branch = extract_branch_name(value, role)
        .map(|name| normalize_branch_name(&name))
        .ok_or_else(|| format!("Pull request is missing the {role} branch."))?;
    let repo_name = extract_repo_name(value, role);
    let repo_owner = extract_repo_owner(value, role);
    let clone_url = extract_repo_clone_url(value, role).or_else(|| {
        repo_owner.as_ref().zip(repo_name.as_ref()).map(|(owner, repo)| {
            format!("https://gitee.com/{owner}/{repo}.git")
        })
    });

    Ok(PullRequestBranchRef {
        branch,
        repo_owner,
        repo_name,
        clone_url,
    })
}

fn resolve_fetch_source(
    repo_path: &Path,
    branch_ref: &PullRequestBranchRef,
    fallback_repo: &ReviewProviderInfo,
) -> Result<String, String> {
    if let (Some(owner), Some(repo)) = (&branch_ref.repo_owner, &branch_ref.repo_name) {
        if let Some(remote_name) = find_remote_name_for_repo(repo_path, owner, repo) {
            return Ok(remote_name);
        }
    }

    if let Some(clone_url) = &branch_ref.clone_url {
        return Ok(clone_url.clone());
    }

    Ok(fallback_repo.remote_name.clone())
}

fn fetch_gitee_git_auth(access_token: &str) -> Result<GiteeGitAuth, String> {
    let user = gitee_get(access_token, "/user", Vec::new())?;
    let username = first_string(
        &user,
        &[
            &["login"],
            &["username"],
            &["path"],
            &["name"],
        ],
    )
    .and_then(|value| clean_optional(&value))
    .ok_or_else(|| "Could not resolve the Gitee username for git authentication.".to_string())?;

    Ok(GiteeGitAuth {
        username,
        access_token: access_token.to_string(),
    })
}

fn fetch_provider_git_auth(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<GitHttpAuth, String> {
    match provider.kind {
        ReviewProviderKind::Gitee => fetch_gitee_git_auth(access_token),
        ReviewProviderKind::Github => Ok(GitHttpAuth {
            username: "x-access-token".to_string(),
            access_token: access_token.to_string(),
        }),
        ReviewProviderKind::Gitlab => Ok(GitHttpAuth {
            username: "oauth2".to_string(),
            access_token: access_token.to_string(),
        }),
    }
}

fn fetch_source_uses_gitee_https(repo_path: &Path, source: &str) -> bool {
    resolve_fetch_source_url(repo_path, source)
        .as_deref()
        .is_some_and(is_gitee_https_url)
}

fn fetch_source_uses_provider_https(
    repo_path: &Path,
    source: &str,
    provider: &ReviewProviderInfo,
) -> bool {
    resolve_fetch_source_url(repo_path, source)
        .as_deref()
        .is_some_and(|url| is_provider_https_url(url, provider))
}

fn resolve_fetch_source_url(repo_path: &Path, source: &str) -> Option<String> {
    let source = source.trim();
    if source.starts_with("https://") || source.starts_with("http://") {
        return Some(source.to_string());
    }

    list_git_remotes(repo_path)
        .ok()?
        .into_iter()
        .find(|remote| remote.name == source)
        .and_then(|remote| remote.fetch_url.or(remote.push_url))
}

fn git_http_auth_header(auth: &GitHttpAuth) -> String {
    let credentials = STANDARD.encode(format!("{}:{}", auth.username, auth.access_token));
    format!("Authorization: Basic {credentials}")
}

fn fetch_branch_to_ref(
    repo_path: &Path,
    source: &str,
    branch_name: &str,
    destination_ref: &str,
    git_auth: Option<&GitHttpAuth>,
) -> Result<(), String> {
    let branch_name = normalize_branch_name(branch_name);
    let mut args = Vec::new();

    if let Some(auth) = git_auth {
        args.push("-c".to_string());
        args.push(format!("http.extraHeader={}", git_http_auth_header(auth)));
        args.push("-c".to_string());
        args.push("credential.interactive=false".to_string());
    }

    args.extend([
        "fetch".to_string(),
        "--force".to_string(),
        source.to_string(),
        format!("{}:{}", branch_name, destination_ref),
    ]);

    run_git(repo_path, &args)?;

    Ok(())
}

fn cleanup_gitee_code_review(
    repo_path: &Path,
    pr_number: i64,
    response: &Value,
) -> Result<(), String> {
    let base = extract_pull_request_branch_ref(response, "base")?;
    let head = extract_pull_request_branch_ref(response, "head")?;
    cleanup_code_review_worktree_for_refs(repo_path, pr_number, &base.branch, &head.branch)
}

fn merge_ref_without_staging(repo_path: &Path, head_ref: &str) -> Result<(), String> {
    let merge_result = run_git(
        repo_path,
        &[
            "merge".to_string(),
            "--squash".to_string(),
            head_ref.to_string(),
        ],
    );
    let reset_result = run_git(repo_path, &["reset".to_string()]);

    match (merge_result, reset_result) {
        (Ok(_), Ok(_)) => Ok(()),
        (Err(merge_error), Ok(_)) => Err(merge_error),
        (Ok(_), Err(reset_error)) => Err(reset_error),
        (Err(merge_error), Err(reset_error)) => Err(format!(
            "{merge_error}\nFailed to unstage merged changes: {reset_error}"
        )),
    }
}

fn split_owner_repo(path: &str) -> Option<(String, String)> {
    let cleaned = path.trim().trim_matches('/').trim_end_matches(".git");
    let segments = cleaned
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }
    let owner = segments[..segments.len() - 1].join("/");
    let repo = segments.last()?.to_string();
    Some((owner, repo))
}

fn gitee_get(
    access_token: &str,
    path: &str,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    let client = gitee_client()?;
    let mut full_query = vec![("access_token".to_string(), access_token.to_string())];
    full_query.extend(query);

    let response = client
        .get(format!("https://gitee.com/api/v5{}", path))
        .query(&full_query)
        .send()
        .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

    parse_json_response(response)
}

fn gitee_post(
    access_token: &str,
    path: &str,
    form: Vec<(String, String)>,
) -> Result<Value, String> {
    let client = gitee_client()?;
    let response = client
        .post(format!("https://gitee.com/api/v5{}", path))
        .query(&[("access_token", access_token)])
        .form(&form)
        .send()
        .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

    parse_json_response(response)
}

fn gitee_client() -> Result<reqwest::blocking::Client, String> {
    api_client("Gitee")
}

fn api_client(label: &str) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("WorktreeDesk/0.1")
        .build()
        .map_err(|error| format!("Could not initialize {label} client: {error}"))
}

fn parse_json_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    parse_json_response_with_label("Gitee", response)
}

fn parse_json_response_with_label(
    label: &str,
    response: reqwest::blocking::Response,
) -> Result<Value, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read {label} response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "{label} API returned {}: {}",
            status,
            summarize_api_error(&body)
        ));
    }

    if body.trim().is_empty() {
        return Ok(Value::Null);
    }

    serde_json::from_str(&body)
        .map_err(|error| format!("Could not parse {label} response: {error}"))
}

fn summarize_api_error(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            first_string(
                &value,
                &[
                    &["message"],
                    &["error"],
                    &["error_description"],
                    &["error_msg"],
                ],
            )
        })
        .unwrap_or_else(|| body.trim().to_string())
}

fn extract_branch_name(value: &Value, role: &str) -> Option<String> {
    match role {
        "head" => first_string(
            value,
            &[
                &["head", "ref"],
                &["head", "branch"],
                &["source_branch"],
                &["sourceBranch"],
                &["head_branch"],
            ],
        ),
        "base" => first_string(
            value,
            &[
                &["base", "ref"],
                &["base", "branch"],
                &["target_branch"],
                &["targetBranch"],
                &["base_branch"],
            ],
        ),
        _ => None,
    }
}

fn extract_repo_full_name(value: &Value, role: &str) -> Option<String> {
    match role {
        "head" => first_string(
            value,
            &[
                &["head", "repo", "full_name"],
                &["head", "repo", "path_with_namespace"],
                &["source_repo", "full_name"],
            ],
        )
        .or_else(|| {
            extract_repo_owner(value, role)
                .zip(extract_repo_name(value, role))
                .map(|(owner, repo)| format!("{owner}/{repo}"))
        }),
        "base" => first_string(
            value,
            &[
                &["base", "repo", "full_name"],
                &["base", "repo", "path_with_namespace"],
                &["target_repo", "full_name"],
            ],
        )
        .or_else(|| {
            extract_repo_owner(value, role)
                .zip(extract_repo_name(value, role))
                .map(|(owner, repo)| format!("{owner}/{repo}"))
        }),
        _ => None,
    }
}

fn extract_repo_owner(value: &Value, role: &str) -> Option<String> {
    match role {
        "head" => first_string(
            value,
            &[
                &["head", "repo", "namespace"],
                &["head", "repo", "owner", "login"],
                &["source_repo", "namespace"],
                &["source_repo", "owner", "login"],
            ],
        )
        .or_else(|| {
            extract_repo_full_name(value, role)
                .and_then(|full_name| split_owner_repo(&full_name).map(|(owner, _)| owner))
        }),
        "base" => first_string(
            value,
            &[
                &["base", "repo", "namespace"],
                &["base", "repo", "owner", "login"],
                &["target_repo", "namespace"],
                &["target_repo", "owner", "login"],
            ],
        )
        .or_else(|| {
            extract_repo_full_name(value, role)
                .and_then(|full_name| split_owner_repo(&full_name).map(|(owner, _)| owner))
        }),
        _ => None,
    }
}

fn extract_repo_name(value: &Value, role: &str) -> Option<String> {
    match role {
        "head" => first_string(
            value,
            &[
                &["head", "repo", "path"],
                &["head", "repo", "name"],
                &["source_repo", "path"],
                &["source_repo", "name"],
            ],
        )
        .or_else(|| {
            extract_repo_full_name(value, role)
                .and_then(|full_name| split_owner_repo(&full_name).map(|(_, repo)| repo))
        }),
        "base" => first_string(
            value,
            &[
                &["base", "repo", "path"],
                &["base", "repo", "name"],
                &["target_repo", "path"],
                &["target_repo", "name"],
            ],
        )
        .or_else(|| {
            extract_repo_full_name(value, role)
                .and_then(|full_name| split_owner_repo(&full_name).map(|(_, repo)| repo))
        }),
        _ => None,
    }
}

fn extract_repo_clone_url(value: &Value, role: &str) -> Option<String> {
    match role {
        "head" => first_string(
            value,
            &[
                &["head", "repo", "clone_url"],
                &["head", "repo", "html_url"],
                &["head", "repo", "ssh_url"],
                &["source_repo", "clone_url"],
                &["source_repo", "html_url"],
            ],
        ),
        "base" => first_string(
            value,
            &[
                &["base", "repo", "clone_url"],
                &["base", "repo", "html_url"],
                &["base", "repo", "ssh_url"],
                &["target_repo", "clone_url"],
                &["target_repo", "html_url"],
            ],
        ),
        _ => None,
    }
}

fn extract_pull_request_web_url(value: &Value) -> Option<String> {
    first_string(value, &[&["html_url"], &["htmlUrl"], &["url"], &["web_url"]])
}

fn first_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .find_map(|path| value_at_path(value, path).and_then(value_as_string))
}

fn first_i64(value: &Value, paths: &[&[&str]]) -> Option<i64> {
    paths.iter().find_map(|path| {
        value_at_path(value, path).and_then(|entry| match entry {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.parse::<i64>().ok(),
            _ => None,
        })
    })
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => clean_optional(text),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn normalize_branch_name(branch: &str) -> String {
    branch.trim().trim_start_matches("refs/heads/").to_string()
}

fn code_review_root(repo_path: &Path) -> Result<PathBuf, String> {
    repo_path
        .parent()
        .ok_or_else(|| format!("Could not resolve parent directory for {}", repo_path.display()))
        .map(|parent| parent.join("CodeReview"))
}

fn code_review_worktree_name(base_branch: &str, head_branch: &str) -> String {
    format!(
        "cr_{}_{}",
        sanitize_path_component(base_branch),
        sanitize_path_component(head_branch)
    )
}

fn code_review_branch_name(base_branch: &str, head_branch: &str, pr_number: i64) -> String {
    format!(
        "review/{}/{}/pr-{}",
        sanitize_ref_component(base_branch),
        sanitize_ref_component(head_branch),
        pr_number
    )
}

fn is_git_worktree(path: &Path) -> bool {
    path.join(".git").exists()
}

fn abort_merge_if_needed(repo_path: &Path) -> Result<(), String> {
    if run_git(
        repo_path,
        &[
            "rev-parse".to_string(),
            "-q".to_string(),
            "--verify".to_string(),
            "MERGE_HEAD".to_string(),
        ],
    )
    .is_ok()
    {
        run_git(repo_path, &["merge".to_string(), "--abort".to_string()])?;
    }

    Ok(())
}

fn is_empty_directory(path: &Path) -> Result<bool, String> {
    if !path.is_dir() {
        return Ok(false);
    }

    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("Could not inspect directory {}: {error}", path.display()))?;

    Ok(entries.next().is_none())
}

fn remove_directory_if_empty(path: &Path) -> Result<(), String> {
    if path.exists() && is_empty_directory(path)? {
        fs::remove_dir(path)
            .map_err(|error| format!("Could not remove empty directory {}: {error}", path.display()))?;
    }

    Ok(())
}

fn ensure_git_worktree(path: &Path) -> Result<(), String> {
    if is_git_worktree(path) {
        Ok(())
    } else {
        Err(format!("Git worktree was not created at {}", path.display()))
    }
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => character,
            _ => '-',
        })
        .collect::<String>();
    let compact = sanitized.trim_matches('-').to_string();

    if compact.is_empty() {
        "review".to_string()
    } else {
        compact
    }
}

fn sanitize_ref_component(value: &str) -> String {
    sanitize_path_component(value).replace("..", "-")
}

fn require_provider_access_token(
    access_token: &str,
    provider: &ReviewProviderInfo,
) -> Result<String, String> {
    clean_required(access_token, &format!("{} API Token", provider.display_name))
}

fn require_access_token(access_token: &str) -> Result<String, String> {
    clean_required(access_token, "Gitee API Key")
}

fn cleanup_code_review_worktree_for_refs(
    repo_path: &Path,
    pr_number: i64,
    base_branch: &str,
    head_branch: &str,
) -> Result<(), String> {
    let code_review_root = code_review_root(repo_path)?;
    let worktree_path = code_review_root.join(code_review_worktree_name(base_branch, head_branch));

    if !worktree_path.exists() {
        return Ok(());
    }

    if is_git_worktree(&worktree_path) {
        run_git(
            repo_path,
            &[
                "worktree".to_string(),
                "remove".to_string(),
                "--force".to_string(),
                path_arg(&worktree_path),
            ],
        )?;
    } else if worktree_path.is_dir() {
        fs::remove_dir_all(&worktree_path).map_err(|error| {
            format!(
                "Could not remove CodeReview directory {} for PR {}: {error}",
                worktree_path.display(),
                pr_number
            )
        })?;
    } else {
        fs::remove_file(&worktree_path).map_err(|error| {
            format!(
                "Could not remove CodeReview file {} for PR {}: {error}",
                worktree_path.display(),
                pr_number
            )
        })?;
    }

    remove_directory_if_empty(&code_review_root)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{code_review_branch_name, code_review_worktree_name};

    #[test]
    fn code_review_worktree_name_keeps_target_then_source_order() {
        assert_eq!(
            code_review_worktree_name("release/2026", "feature/login"),
            "cr_release-2026_feature-login"
        );
    }

    #[test]
    fn code_review_branch_name_uses_target_and_source_segments() {
        assert_eq!(
            code_review_branch_name("release/2026", "feature/login", 42),
            "review/release-2026/feature-login/pr-42"
        );
    }
}
