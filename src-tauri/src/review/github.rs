use serde_json::Value;
use std::path::Path;

use crate::{
    models::{
        CodeReviewResult, GiteePullRequestActionRequest, PullRequestChangedFileInfo,
        PullRequestCommitInfo, PullRequestInfo, RepositoryInfo, RepositoryMemberInfo,
        ReviewProviderInfo,
    },
    repository::inspect_repository,
};

use super::{
    api::github::{
        approve_pull_request_review as github_api_approve_pull_request_review,
        get_authenticated_user, get_pull_request as github_api_get_pull_request,
        get_pull_request_commit_status, list_pull_request_commits as github_api_list_pull_request_commits,
        list_pull_request_files as github_api_list_pull_request_files,
        list_pull_request_reviews as github_api_list_pull_request_reviews,
        list_pull_requests as github_api_list_pull_requests,
        list_repository_collaborators,
    },
    shared::{
        cleanup_code_review_worktree_for_refs, extract_branch_name,
        extract_pull_request_branch_ref, extract_pull_request_web_url, extract_repo_full_name,
        first_i64, first_string, prepare_provider_code_review, require_provider_access_token,
    },
};

pub(crate) fn list_github_pull_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Vec<PullRequestInfo>, String> {
    let response = github_api_list_pull_requests(provider, access_token)?;

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
    let response = github_api_get_pull_request(provider, access_token, number)?;
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
    let pull_request = github_api_get_pull_request(provider, &access_token, request.number)?;
    let (review_action_allowed, review_action_blocked_reason) =
        github_review_action_state(&pull_request, current_login.as_deref());

    if review_action_allowed == Some(false) {
        return Err(
            review_action_blocked_reason
                .unwrap_or_else(|| "GitHub does not allow this review approval.".to_string()),
        );
    }

    github_api_approve_pull_request_review(provider, &access_token, request.number)?;

    inspect_repository(repo_path)
}

pub(crate) fn list_github_pull_request_commits(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestCommitInfo>, String> {
    let response = github_api_list_pull_request_commits(provider, access_token, number)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitHub pull request commit response.".to_string())?
        .iter()
        .map(map_pull_request_commit)
        .collect()
}

pub(crate) fn list_github_pull_request_files(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestChangedFileInfo>, String> {
    let response = github_api_list_pull_request_files(provider, access_token, number)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitHub pull request file response.".to_string())?
        .iter()
        .map(map_pull_request_file)
        .collect()
}

pub(crate) fn list_github_repository_members(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Vec<RepositoryMemberInfo>, String> {
    let response = list_repository_collaborators(provider, access_token)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitHub repository collaborator response.".to_string())?
        .iter()
        .map(map_repository_member)
        .collect()
}

pub(crate) fn prepare_github_code_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<CodeReviewResult, String> {
    let response = github_api_get_pull_request(provider, access_token, number)?;
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
    let response = github_api_get_pull_request(provider, access_token, number)?;
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

fn map_pull_request_commit(value: &Value) -> Result<PullRequestCommitInfo, String> {
    let sha = first_string(value, &[&["sha"], &["id"]])
        .ok_or_else(|| "Pull request commit is missing its sha.".to_string())?;

    Ok(PullRequestCommitInfo {
        sha,
        message: first_string(value, &[&["commit", "message"], &["message"], &["title"]]),
        author: first_string(
            value,
            &[
                &["author", "login"],
                &["author", "name"],
                &["commit", "author", "name"],
                &["committer", "login"],
                &["user", "login"],
                &["user", "name"],
            ],
        ),
        authored_at: first_string(
            value,
            &[
                &["commit", "author", "date"],
                &["created_at"],
                &["authored_date"],
                &["timestamp"],
            ],
        ),
        web_url: first_string(value, &[&["html_url"], &["web_url"], &["url"]]),
    })
}

fn map_pull_request_file(value: &Value) -> Result<PullRequestChangedFileInfo, String> {
    let filename = first_string(value, &[&["filename"], &["path"], &["new_path"], &["old_path"]])
        .ok_or_else(|| "Pull request file entry is missing its filename.".to_string())?;

    Ok(PullRequestChangedFileInfo {
        filename,
        status: first_string(value, &[&["status"], &["type"]]),
        additions: first_i64(value, &[&["additions"]]),
        deletions: first_i64(value, &[&["deletions"]]),
        changes: first_i64(value, &[&["changes"]]),
        blob_url: first_string(value, &[&["blob_url"]]),
        raw_url: first_string(value, &[&["raw_url"], &["contents_url"]]),
        patch: first_string(value, &[&["patch"]]),
    })
}

fn map_repository_member(value: &Value) -> Result<RepositoryMemberInfo, String> {
    let username = first_string(
        value,
        &[
            &["login"],
            &["name"],
            &["user", "login"],
            &["user", "name"],
        ],
    )
    .ok_or_else(|| "Repository member entry is missing its identity.".to_string())?;
    let display_name = first_string(
        value,
        &[
            &["name"],
            &["nickname"],
            &["login"],
            &["user", "name"],
            &["user", "login"],
        ],
    )
    .unwrap_or_else(|| username.clone());

    Ok(RepositoryMemberInfo {
        username,
        display_name,
        avatar_url: first_string(value, &[&["avatar_url"], &["user", "avatar_url"]]),
        profile_url: first_string(value, &[&["html_url"], &["web_url"], &["url"]]),
        role_name: first_string(value, &[&["role_name"], &["permission"]]),
        permission: extract_github_permission(value),
    })
}

fn extract_github_permission(value: &Value) -> Option<String> {
    if let Some(permission) = first_string(value, &[&["permission"]]) {
        return Some(permission);
    }

    let permissions = value.get("permissions")?;
    for (field, label) in [
        ("admin", "admin"),
        ("maintain", "maintain"),
        ("push", "push"),
        ("triage", "triage"),
        ("pull", "pull"),
    ] {
        if permissions.get(field).and_then(Value::as_bool) == Some(true) {
            return Some(label.to_string());
        }
    }

    None
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

    let reviews = github_api_list_pull_request_reviews(provider, access_token, number)?;

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
    let user = get_authenticated_user(access_token)?;
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
    let status = get_pull_request_commit_status(provider, access_token, &sha)?;

    Ok(first_string(&status, &[&["state"]]).map(|state| state.to_lowercase()))
}
