use serde_json::Value;

use crate::{
    common::{expand_home, path_arg},
    models::{
        CodeReviewResult, GiteeCodeReviewRequest, GiteePullRequestActionRequest,
        GiteePullRequestDetailRequest, GiteePullRequestInfo, GiteePullRequestListRequest,
        GiteeRepositoryInfo, PullRequestChangedFileInfo, PullRequestCommitInfo,
        PullRequestPage,
        RepositoryInfo, RepositoryMemberInfo,
    },
    provider::require_gitee_repository,
    repository::inspect_repository,
};

use super::{
    api::gitee::{
        approve_pull_request_review as gitee_api_approve_pull_request_review,
        approve_pull_request_test as gitee_api_approve_pull_request_test,
        get_pull_request as gitee_api_get_pull_request,
        list_pull_request_commits as gitee_api_list_pull_request_commits,
        list_pull_request_files as gitee_api_list_pull_request_files,
        list_pull_requests as gitee_api_list_pull_requests, merge_pull_request as gitee_api_merge_pull_request,
        list_repository_subscribers, reset_pull_request_review as gitee_api_reset_pull_request_review,
        reset_pull_request_test as gitee_api_reset_pull_request_test,
        update_pull_request_state as gitee_api_update_pull_request_state,
    },
    shared::{
        cleanup_code_review_worktree_for_refs, extract_branch_name,
        extract_pull_request_branch_ref, extract_pull_request_web_url, extract_repo_full_name,
        fetch_provider_git_auth, fetch_source_uses_provider_https, first_i64, first_string,
        prepare_review_worktree, require_access_token, resolve_fetch_source,
    },
};

#[tauri::command]
pub(crate) fn list_gitee_pull_requests(
    request: GiteePullRequestListRequest,
) -> Result<PullRequestPage, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let requested_state = normalize_requested_pull_request_state(
        request.state.as_deref().unwrap_or("open"),
    );
    let page = request.page.unwrap_or(1).max(1);
    let per_page = request.per_page.unwrap_or(10).max(1);

    if requested_state == "open" || requested_state == "closed" {
        let api_state = if requested_state == "open" { "open" } else { "closed" };
        let response = gitee_api_list_pull_requests(&repo, &access_token, api_state, page, per_page)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected Gitee PR list response.".to_string())?;

        return Ok(PullRequestPage {
            state: requested_state.to_string(),
            page,
            per_page,
            has_more: entries.len() as u32 >= per_page,
            items: entries
                .iter()
                .map(|entry| map_gitee_pull_request(entry, &repo))
                .collect::<Result<Vec<_>, _>>()?,
        });
    }

    let (entries, has_more) = collect_gitee_filtered_page(&repo, &access_token, requested_state, page, per_page)?;

    Ok(PullRequestPage {
        state: requested_state.to_string(),
        page,
        per_page,
        has_more,
        items: entries
            .iter()
            .map(|entry| map_gitee_pull_request(entry, &repo))
            .collect::<Result<Vec<_>, _>>()?,
    })
}

pub(crate) fn count_gitee_pull_requests(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    requested_state: &str,
) -> Result<u64, String> {
    let normalized_state = normalize_requested_pull_request_state(requested_state);
    let api_state = if normalized_state == "open" {
        "open"
    } else if normalized_state == "closed" {
        "closed"
    } else {
        "all"
    };
    let mut remote_page = 1;
    let mut total = 0_u64;

    loop {
        let response = gitee_api_list_pull_requests(repo, access_token, api_state, remote_page, 100)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected Gitee PR list response.".to_string())?;

        total += entries
            .iter()
            .filter(|entry| gitee_pull_request_group(entry) == normalized_state)
            .count() as u64;

        if entries.len() < 100 {
            break;
        }

        remote_page += 1;
    }

    Ok(total)
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

    gitee_api_approve_pull_request_review(&repo, &access_token, request.number)?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn approve_gitee_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_approve_pull_request_test(&repo, &access_token, request.number)?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn reset_gitee_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_reset_pull_request_review(&repo, &access_token, request.number)?;

    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn reset_gitee_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_reset_pull_request_test(&repo, &access_token, request.number)?;

    inspect_repository(&repo_path)
}

pub(crate) fn reopen_gitee_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_update_pull_request_state(&repo, &access_token, request.number, "open")?;

    inspect_repository(&repo_path)
}

pub(crate) fn close_gitee_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_update_pull_request_state(&repo, &access_token, request.number, "closed")?;

    inspect_repository(&repo_path)
}

pub(crate) fn merge_gitee_pull_request(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_api_merge_pull_request(&repo, &access_token, request.number)?;

    inspect_repository(&repo_path)
}

pub(crate) fn list_gitee_pull_request_commits(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestCommitInfo>, String> {
    let response = gitee_api_list_pull_request_commits(repo, access_token, number)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected Gitee pull request commit response.".to_string())?
        .iter()
        .map(map_pull_request_commit)
        .collect()
}

pub(crate) fn list_gitee_pull_request_files(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Vec<PullRequestChangedFileInfo>, String> {
    let response = gitee_api_list_pull_request_files(repo, access_token, number)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected Gitee pull request file response.".to_string())?
        .iter()
        .map(map_pull_request_file)
        .collect()
}

pub(crate) fn list_gitee_repository_members(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
) -> Result<Vec<RepositoryMemberInfo>, String> {
    let response = list_repository_subscribers(repo, access_token)?;

    response
        .as_array()
        .ok_or_else(|| "Unexpected Gitee repository member response.".to_string())?
        .iter()
        .map(map_repository_member)
        .collect()
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
    let state = normalize_gitee_pull_request_state(first_string(value, &[&["state"], &["status"]]));
    let review_status = first_string(
        value,
        &[
            &["review_status"],
            &["reviewStatus"],
            &["review_state"],
            &["reviewState"],
        ],
    )
    .or_else(|| (state.as_deref() == Some("open")).then(|| "pending".to_string()));
    let test_status = first_string(
        value,
        &[
            &["test_status"],
            &["testStatus"],
            &["test_state"],
            &["testState"],
        ],
    )
    .or_else(|| (state.as_deref() == Some("open")).then(|| "pending".to_string()));

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
        state,
        created_at: first_string(value, &[&["created_at"], &["createdAt"]]),
        updated_at: first_string(value, &[&["updated_at"], &["updatedAt"]]),
        web_url: extract_pull_request_web_url(value)
            .unwrap_or_else(|| format!("{}/pulls/{}", repo.web_url, number)),
        source_branch: extract_branch_name(value, "head"),
        target_branch: extract_branch_name(value, "base"),
        source_repo: extract_repo_full_name(value, "head"),
        target_repo: extract_repo_full_name(value, "base"),
        review_status,
        test_status,
        review_action_allowed: None,
        review_action_blocked_reason: None,
    })
}

fn normalize_gitee_pull_request_state(raw_state: Option<String>) -> Option<String> {
    let state = raw_state?
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

fn gitee_pull_request_group(value: &Value) -> &'static str {
    match normalize_gitee_pull_request_state(first_string(value, &[&["state"], &["status"]])).as_deref() {
        Some("merged") => "merged",
        Some("closed") => "closed",
        Some("reverted") => "reverted",
        _ => "open",
    }
}

fn collect_gitee_filtered_page(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
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
        let response = gitee_api_list_pull_requests(repo, access_token, "all", remote_page, 100)?;
        let entries = response
            .as_array()
            .ok_or_else(|| "Unexpected Gitee PR list response.".to_string())?;

        for entry in entries {
            if gitee_pull_request_group(entry) != requested_state {
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
                &["author", "nickname"],
                &["commit", "author", "name"],
                &["user", "name"],
                &["user", "login"],
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
        web_url: first_string(value, &[&["html_url"], &["url"], &["web_url"]]),
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
        blob_url: first_string(value, &[&["blob_url"], &["html_url"]]),
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
            &["nickname"],
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
        profile_url: first_string(value, &[&["html_url"], &["url"], &["web_url"]]),
        role_name: first_string(value, &[&["role_name"], &["membership_type"]])
            .or_else(|| Some("subscriber".to_string())),
        permission: first_string(value, &[&["permission"]]),
    })
}

fn fetch_gitee_pull_request_value(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    gitee_api_get_pull_request(repo, access_token, number)
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
