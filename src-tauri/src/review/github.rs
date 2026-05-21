use serde_json::Value;
use std::path::Path;

use crate::{
    models::{
        CodeReviewResult, GiteePullRequestActionRequest, PullRequestInfo, RepositoryInfo,
        ReviewProviderInfo,
    },
    repository::inspect_repository,
};

use super::shared::{
    api_client, cleanup_code_review_worktree_for_refs, extract_branch_name,
    extract_pull_request_branch_ref, extract_pull_request_web_url, extract_repo_full_name,
    first_i64, first_string, parse_json_response_with_label, prepare_provider_code_review,
    require_provider_access_token,
};

pub(crate) fn list_github_pull_requests(
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

pub(crate) fn get_github_pull_request_detail(
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

pub(crate) fn approve_github_pull_request_review(
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

pub(crate) fn prepare_github_code_review(
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

pub(crate) fn cleanup_github_code_review_worktree(
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