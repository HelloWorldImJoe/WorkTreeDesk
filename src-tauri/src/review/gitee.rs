use serde_json::Value;

use crate::{
    common::{expand_home, path_arg},
    models::{
        CodeReviewResult, GiteeCodeReviewRequest, GiteePullRequestActionRequest,
        GiteePullRequestDetailRequest, GiteePullRequestInfo, GiteePullRequestListRequest,
        GiteeRepositoryInfo, RepositoryInfo,
    },
    provider::require_gitee_repository,
    repository::inspect_repository,
};

use super::shared::{
    api_client, cleanup_code_review_worktree_for_refs, extract_branch_name,
    extract_pull_request_branch_ref, extract_pull_request_web_url, extract_repo_full_name,
    fetch_provider_git_auth, fetch_source_uses_provider_https, first_i64, first_string,
    parse_json_response, prepare_review_worktree, require_access_token, resolve_fetch_source,
};

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

/// Gitee 代码评审准备流程。
///
/// 这里会先读取 PR 的 base/head 分支，再把它们拉取到内部 refs，并在 CodeReview
/// 目录下创建或刷新一个专用 worktree，方便用户用本地工具审查差异。
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
    let code_review_root = super::shared::code_review_root(&repo_path)?;
    let worktree_name = super::shared::code_review_worktree_name(&base.branch, &head.branch);
    let worktree_path = code_review_root.join(worktree_name);
    let review_branch = super::shared::code_review_branch_name(&base.branch, &head.branch, request.number);
    let base_ref = format!("refs/worktree-desk/base/pr-{}", request.number);
    let head_ref = format!("refs/worktree-desk/head/pr-{}", request.number);
    let base_source = resolve_fetch_source(&repo_path, &base, &repo)?;
    let head_source = resolve_fetch_source(&repo_path, &head, &repo)?;
    let git_auth = if fetch_source_uses_provider_https(&repo_path, &base_source, &repo)
        || fetch_source_uses_provider_https(&repo_path, &head_source, &repo)
    {
        Some(fetch_provider_git_auth(&repo, &access_token)?)
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

fn cleanup_gitee_code_review(
    repo_path: &std::path::Path,
    pr_number: i64,
    response: &Value,
) -> Result<(), String> {
    let base = extract_pull_request_branch_ref(response, "base")?;
    let head = extract_pull_request_branch_ref(response, "head")?;
    cleanup_code_review_worktree_for_refs(repo_path, pr_number, &base.branch, &head.branch)
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