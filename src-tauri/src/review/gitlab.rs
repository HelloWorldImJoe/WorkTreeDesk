use serde_json::Value;
use std::path::Path;

use crate::{
    models::{
        CodeReviewResult, GiteePullRequestActionRequest, PullRequestBranchRef, PullRequestInfo,
        RepositoryInfo, ReviewProviderInfo,
    },
    repository::inspect_repository,
};

use super::shared::{
    api_client, cleanup_code_review_worktree_for_refs, extract_pull_request_web_url,
    first_i64, first_string, normalize_branch_name, parse_json_response_with_label,
    prepare_provider_code_review, require_provider_access_token, split_owner_repo,
};

pub(crate) fn list_gitlab_merge_requests(
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
            let test_status = first_string(entry, &[&["head_pipeline", "status"], &["pipeline", "status"]]);
            map_gitlab_merge_request(entry, provider, None, test_status)
        })
        .collect()
}

pub(crate) fn get_gitlab_merge_request_detail(
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

pub(crate) fn approve_gitlab_merge_request_review(
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

pub(crate) fn reset_gitlab_merge_request_review(
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

pub(crate) fn prepare_gitlab_code_review(
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

pub(crate) fn cleanup_gitlab_code_review_worktree(
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
            entries.iter().any(|entry| first_i64(entry, &[&["user", "id"], &["id"]]) == Some(user_id))
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