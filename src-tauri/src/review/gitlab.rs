use serde_json::Value;
use std::path::Path;

use crate::{
    models::{
        CodeReviewResult, GiteePullRequestActionRequest, PullRequestBranchRef,
        PullRequestChangedFileInfo, PullRequestCommitInfo, PullRequestInfo, PullRequestPage,
        RepositoryInfo,
        RepositoryMemberInfo, ReviewProviderInfo,
    },
    repository::inspect_repository,
};

use super::{
    api::gitlab::{
        approve_merge_request as gitlab_api_approve_merge_request,
        get_authenticated_user as gitlab_api_get_authenticated_user,
        get_merge_request as gitlab_api_get_merge_request,
        get_merge_request_approvals as gitlab_api_get_merge_request_approvals,
        get_project as gitlab_api_get_project,
        list_merge_request_changes as gitlab_api_list_merge_request_changes,
        list_merge_request_commits as gitlab_api_list_merge_request_commits,
        list_merge_requests as gitlab_api_list_merge_requests, merge_merge_request as gitlab_api_merge_merge_request,
        list_project_members as gitlab_api_list_project_members,
        unapprove_merge_request as gitlab_api_unapprove_merge_request,
        update_merge_request_state as gitlab_api_update_merge_request_state,
    },
    shared::{
        cleanup_code_review_worktree_for_refs, extract_pull_request_web_url, first_i64,
        first_string, normalize_branch_name, prepare_provider_code_review,
        require_provider_access_token, split_owner_repo,
    },
};

pub(crate) fn list_gitlab_merge_requests_by_state(
    provider: &ReviewProviderInfo,
    access_token: &str,
    requested_state: &str,
    page: u32,
    per_page: u32,
) -> Result<PullRequestPage, String> {
    let normalized_state = normalize_requested_pull_request_state(requested_state);
    let page = page.max(1);
    let per_page = per_page.max(1);

    if normalized_state == "open" {
        let response = gitlab_api_list_merge_requests(provider, access_token, "opened", page, per_page)?;
        let current_user_id = gitlab_current_user_id(provider, access_token)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected GitLab merge request response.".to_string())?;

        return Ok(PullRequestPage {
            state: normalized_state.to_string(),
            page,
            per_page,
            has_more: entries.len() as u32 >= per_page,
            items: entries
                .iter()
                .map(|entry| {
                    let number = first_i64(entry, &[&["iid"], &["number"], &["id"]])
                        .ok_or_else(|| "GitLab merge request is missing its IID.".to_string())?;
                    let review_status = gitlab_review_status_for_user_id(
                        provider,
                        access_token,
                        number,
                        current_user_id,
                    )?
                    .or_else(|| Some("pending".to_string()));
                    let test_status = first_string(entry, &[&["head_pipeline", "status"], &["pipeline", "status"]]);
                    map_gitlab_merge_request(entry, provider, review_status, test_status)
                })
                .collect::<Result<Vec<_>, _>>()?,
        });
    }

    let api_state = match normalized_state {
        "closed" => "closed",
        "merged" => "merged",
        _ => "all",
    };
    let (entries, has_more) = collect_gitlab_filtered_page(
        provider,
        access_token,
        api_state,
        normalized_state,
        page,
        per_page,
    )?;

    Ok(PullRequestPage {
        state: normalized_state.to_string(),
        page,
        per_page,
        has_more,
        items: entries
            .iter()
            .map(|entry| {
                let test_status = first_string(entry, &[&["head_pipeline", "status"], &["pipeline", "status"]]);
                map_gitlab_merge_request(entry, provider, None, test_status)
            })
            .collect::<Result<Vec<_>, _>>()?,
    })
}

pub(crate) fn count_gitlab_merge_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
    requested_state: &str,
) -> Result<u64, String> {
    let normalized_state = normalize_requested_pull_request_state(requested_state);
    let api_state = match normalized_state {
        "open" => "opened",
        "closed" => "closed",
        "merged" => "merged",
        _ => "all",
    };
    let mut remote_page = 1;
    let mut total = 0_u64;

    loop {
        let response = gitlab_api_list_merge_requests(provider, access_token, api_state, remote_page, 100)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected GitLab merge request response.".to_string())?;

        total += entries
            .iter()
            .filter(|entry| gitlab_merge_request_group(entry) == normalized_state)
            .count() as u64;

        if entries.len() < 100 {
            break;
        }

        remote_page += 1;
    }

    Ok(total)
}

pub(crate) fn get_gitlab_merge_request_detail(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<PullRequestInfo, String> {
    let response = gitlab_api_get_merge_request(provider, access_token, number)?;
    let state = gitlab_merge_request_state(&response);
    let review_status = gitlab_current_user_review_status(provider, access_token, number)?
        .or_else(|| (state.as_deref() == Some("open")).then(|| "pending".to_string()));
    let test_status =
        first_string(&response, &[&["head_pipeline", "status"], &["pipeline", "status"]]);

    map_gitlab_merge_request(&response, provider, review_status, test_status)
}

pub(crate) fn list_gitlab_pull_request_commits(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestCommitInfo>, String> {
    let response = gitlab_api_list_merge_request_commits(provider, access_token, number)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitLab merge request commit response.".to_string())?
        .iter()
        .map(map_pull_request_commit)
        .collect()
}

pub(crate) fn list_gitlab_pull_request_files(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestChangedFileInfo>, String> {
    let response = gitlab_api_list_merge_request_changes(provider, access_token, number)?;

    response
        .get("changes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Unexpected GitLab merge request changed-file response.".to_string())?
        .iter()
    .map(map_pull_request_file)
        .collect()
}

pub(crate) fn list_gitlab_repository_members(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Vec<RepositoryMemberInfo>, String> {
    let response = gitlab_api_list_project_members(provider, access_token)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected GitLab repository member response.".to_string())?
        .iter()
        .map(map_repository_member)
        .collect()
}

pub(crate) fn approve_gitlab_merge_request_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_api_approve_merge_request(provider, &access_token, request.number)?;

    inspect_repository(repo_path)
}

pub(crate) fn reset_gitlab_merge_request_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_api_unapprove_merge_request(provider, &access_token, request.number)?;

    inspect_repository(repo_path)
}

pub(crate) fn reopen_gitlab_merge_request(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_api_update_merge_request_state(provider, &access_token, request.number, "reopen")?;

    inspect_repository(repo_path)
}

pub(crate) fn close_gitlab_merge_request(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_api_update_merge_request_state(provider, &access_token, request.number, "close")?;

    inspect_repository(repo_path)
}

pub(crate) fn merge_gitlab_merge_request(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    request: &GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let access_token = require_provider_access_token(&request.access_token, provider)?;
    gitlab_api_merge_merge_request(provider, &access_token, request.number)?;

    inspect_repository(repo_path)
}

pub(crate) fn prepare_gitlab_code_review(
    repo_path: &Path,
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<CodeReviewResult, String> {
    let response = gitlab_api_get_merge_request(provider, access_token, number)?;
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
    let response = gitlab_api_get_merge_request(provider, access_token, number)?;
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
        state: gitlab_merge_request_state(value),
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
    let user_id = gitlab_current_user_id(provider, access_token)?;
    gitlab_review_status_for_user_id(provider, access_token, number, user_id)
}

fn gitlab_current_user_id(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Option<i64>, String> {
    let user = gitlab_api_get_authenticated_user(provider, access_token)?;
    Ok(first_i64(&user, &[&["id"]]))
}

fn gitlab_review_status_for_user_id(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
    user_id: Option<i64>,
) -> Result<Option<String>, String> {
    let Some(user_id) = user_id else {
        return Ok(None);
    };

    let approvals = gitlab_api_get_merge_request_approvals(provider, access_token, number)?;
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

fn gitlab_merge_request_state(value: &Value) -> Option<String> {
    let state = first_string(value, &[&["state"]])?
        .trim()
        .to_lowercase()
        .replace([' ', '-'], "_");

    let normalized = match state.as_str() {
        "open" | "opened" | "reopened" => "open",
        "closed" | "close" => "closed",
        "merged" | "merge" => "merged",
        "reverted" | "revert" | "abandoned" | "declined" | "rejected" | "locked" => "reverted",
        _ => state.as_str(),
    };

    Some(normalized.to_string())
}

fn gitlab_merge_request_group(value: &Value) -> &'static str {
    match gitlab_merge_request_state(value).as_deref() {
        Some("merged") => "merged",
        Some("closed") => "closed",
        Some("reverted") => "reverted",
        _ => "open",
    }
}

fn collect_gitlab_filtered_page(
    provider: &ReviewProviderInfo,
    access_token: &str,
    api_state: &str,
    requested_state: &str,
    page: u32,
    per_page: u32,
) -> Result<(Vec<Value>, bool), String> {
    let start = ((page - 1) * per_page) as usize;
    let end = start + per_page as usize;
    let mut remote_page = 1;
    let mut matched = 0_usize;
    let mut items = Vec::new();

    loop {
        let response = gitlab_api_list_merge_requests(provider, access_token, api_state, remote_page, 100)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected GitLab merge request response.".to_string())?;

        for entry in entries {
            if gitlab_merge_request_group(entry) != requested_state {
                continue;
            }

            if matched >= start && items.len() < per_page as usize {
                items.push(entry.clone());
            }

            matched += 1;

            if matched > end {
                return Ok((items, true));
            }
        }

        if entries.len() < 100 {
            return Ok((items, false));
        }

        remote_page += 1;
    }
}

fn normalize_requested_pull_request_state(requested_state: &str) -> &str {
    match requested_state.trim().to_lowercase().as_str() {
        "closed" => "closed",
        "merged" => "merged",
        "reverted" => "reverted",
        _ => "open",
    }
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
        Some(id) => gitlab_api_get_project(provider, access_token, id).ok(),
        None => None,
    };
    let target_project = match first_i64(value, &[&["target_project_id"]]) {
        Some(id) => gitlab_api_get_project(provider, access_token, id).ok(),
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

fn map_pull_request_commit(value: &Value) -> Result<PullRequestCommitInfo, String> {
    let sha = first_string(value, &[&["id"], &["sha"]])
        .ok_or_else(|| "GitLab merge request commit is missing its sha.".to_string())?;

    Ok(PullRequestCommitInfo {
        sha,
        message: first_string(value, &[&["message"], &["title"]]),
        author: first_string(
            value,
            &[
                &["author_name"],
                &["author", "name"],
                &["author", "username"],
                &["committer_name"],
            ],
        ),
        authored_at: first_string(
            value,
            &[
                &["authored_date"],
                &["created_at"],
                &["committed_date"],
            ],
        ),
        web_url: first_string(value, &[&["web_url"], &["url"]]),
    })
}

fn map_pull_request_file(value: &Value) -> Result<PullRequestChangedFileInfo, String> {
    let filename = first_string(value, &[&["new_path"], &["old_path"], &["filename"], &["path"]])
        .ok_or_else(|| "GitLab merge request file entry is missing its filename.".to_string())?;
    let patch = first_string(value, &[&["diff"], &["patch"]]);
    let (additions, deletions) = patch
        .as_deref()
        .map(diff_line_stats)
        .unwrap_or((None, None));
    let changes = match (additions, deletions) {
        (Some(additions), Some(deletions)) => Some(additions + deletions),
        _ => None,
    };

    Ok(PullRequestChangedFileInfo {
        filename,
        status: Some(gitlab_change_status(value).to_string()),
        additions,
        deletions,
        changes,
        blob_url: None,
        raw_url: None,
        patch,
    })
}

fn map_repository_member(value: &Value) -> Result<RepositoryMemberInfo, String> {
    let username = first_string(value, &[&["username"], &["name"]])
        .ok_or_else(|| "GitLab repository member entry is missing its identity.".to_string())?;
    let display_name = first_string(value, &[&["name"], &["username"]])
        .unwrap_or_else(|| username.clone());
    let role = first_i64(value, &[&["access_level"]]).and_then(gitlab_access_level_name);

    Ok(RepositoryMemberInfo {
        username,
        display_name,
        avatar_url: first_string(value, &[&["avatar_url"]]),
        profile_url: first_string(value, &[&["web_url"], &["url"]]),
        role_name: role.clone(),
        permission: role,
    })
}

fn gitlab_change_status(value: &Value) -> &'static str {
    if value.get("deleted_file").and_then(Value::as_bool) == Some(true) {
        "removed"
    } else if value.get("new_file").and_then(Value::as_bool) == Some(true) {
        "added"
    } else if value.get("renamed_file").and_then(Value::as_bool) == Some(true) {
        "renamed"
    } else {
        "modified"
    }
}

fn diff_line_stats(diff: &str) -> (Option<i64>, Option<i64>) {
    let mut additions = 0_i64;
    let mut deletions = 0_i64;

    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }

        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (Some(additions), Some(deletions))
}

fn gitlab_access_level_name(access_level: i64) -> Option<String> {
    match access_level {
        5 => Some("minimal".to_string()),
        10 => Some("guest".to_string()),
        15 => Some("planner".to_string()),
        20 => Some("reporter".to_string()),
        30 => Some("developer".to_string()),
        40 => Some("maintainer".to_string()),
        50 => Some("owner".to_string()),
        _ => None,
    }
}