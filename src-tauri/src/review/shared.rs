use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{
    common::{clean_optional, clean_required, path_arg},
    git::{list_git_remotes, run_git},
    models::{
        CodeReviewResult, GitHttpAuth, GiteeGitAuth, PullRequestBranchRef, ReviewProviderInfo,
        ReviewProviderKind,
    },
    provider::{find_remote_name_for_repo, is_provider_https_url},
};

/// provider 无关的评审 worktree 准备流程。
///
/// GitHub 和 GitLab 都会先拿到标准化后的 base/head 引用，再复用这里的公共 git
/// 编排逻辑完成 fetch、建树和 squash merge，避免每个平台重复维护同一套流程。
pub(crate) fn prepare_provider_code_review(
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

/// 创建或复用本地评审 worktree，并把 base/head 分支拉取到内部 refs 后完成 merge。
///
/// 这样做的好处是评审目录可以重复使用，且每次准备评审时都能回到干净的 base 状态，
/// 减少用户在本地处理残留 merge 状态的成本。
pub(crate) fn prepare_review_worktree(
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

pub(crate) fn code_review_root(repo_path: &Path) -> Result<PathBuf, String> {
    repo_path
        .parent()
        .ok_or_else(|| {
            format!(
                "Could not resolve parent directory for {}",
                repo_path.display()
            )
        })
        .map(|parent| parent.join("CodeReview"))
}

pub(crate) fn code_review_worktree_name(base_branch: &str, head_branch: &str) -> String {
    format!(
        "cr_{}_{}",
        sanitize_path_component(base_branch),
        sanitize_path_component(head_branch)
    )
}

pub(crate) fn code_review_branch_name(
    base_branch: &str,
    head_branch: &str,
    pr_number: i64,
) -> String {
    format!(
        "review/{}/{}/pr-{}",
        sanitize_ref_component(base_branch),
        sanitize_ref_component(head_branch),
        pr_number
    )
}

pub(crate) fn extract_pull_request_branch_ref(
    value: &Value,
    role: &str,
) -> Result<PullRequestBranchRef, String> {
    let branch = extract_branch_name(value, role)
        .map(|name| normalize_branch_name(&name))
        .ok_or_else(|| format!("Pull request is missing the {role} branch."))?;
    let repo_name = extract_repo_name(value, role);
    let repo_owner = extract_repo_owner(value, role);
    let clone_url = extract_repo_clone_url(value, role).or_else(|| {
        repo_owner
            .as_ref()
            .zip(repo_name.as_ref())
            .map(|(owner, repo)| format!("https://gitee.com/{owner}/{repo}.git"))
    });

    Ok(PullRequestBranchRef {
        branch,
        repo_owner,
        repo_name,
        clone_url,
    })
}

pub(crate) fn resolve_fetch_source(
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

pub(crate) fn fetch_provider_git_auth(
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

pub(crate) fn fetch_source_uses_provider_https(
    repo_path: &Path,
    source: &str,
    provider: &ReviewProviderInfo,
) -> bool {
    resolve_fetch_source_url(repo_path, source)
        .as_deref()
        .is_some_and(|url| is_provider_https_url(url, provider))
}

pub(crate) fn api_client(label: &str) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("WorktreeDesk/0.1")
        .build()
        .map_err(|error| format!("Could not initialize {label} client: {error}"))
}

pub(crate) fn parse_json_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    parse_json_response_with_label("Gitee", response)
}

pub(crate) fn parse_json_response_with_label(
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

pub(crate) fn extract_branch_name(value: &Value, role: &str) -> Option<String> {
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

pub(crate) fn extract_repo_full_name(value: &Value, role: &str) -> Option<String> {
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

pub(crate) fn extract_pull_request_web_url(value: &Value) -> Option<String> {
    first_string(
        value,
        &[&["html_url"], &["htmlUrl"], &["url"], &["web_url"]],
    )
}

pub(crate) fn first_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .find_map(|path| value_at_path(value, path).and_then(value_as_string))
}

pub(crate) fn first_i64(value: &Value, paths: &[&[&str]]) -> Option<i64> {
    paths.iter().find_map(|path| {
        value_at_path(value, path).and_then(|entry| match entry {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.parse::<i64>().ok(),
            _ => None,
        })
    })
}

pub(crate) fn normalize_branch_name(branch: &str) -> String {
    branch.trim().trim_start_matches("refs/heads/").to_string()
}

pub(crate) fn require_provider_access_token(
    access_token: &str,
    provider: &ReviewProviderInfo,
) -> Result<String, String> {
    clean_required(
        access_token,
        &format!("{} API Token", provider.display_name),
    )
}

pub(crate) fn require_access_token(access_token: &str) -> Result<String, String> {
    clean_required(access_token, "Gitee API Key")
}

pub(crate) fn split_owner_repo(path: &str) -> Option<(String, String)> {
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

pub(crate) fn cleanup_code_review_worktree_for_refs(
    repo_path: &Path,
    pr_number: i64,
    base_branch: &str,
    head_branch: &str,
) -> Result<(), String> {
    let code_review_root = code_review_root(repo_path)?;
    let worktree_path = code_review_root.join(code_review_worktree_name(base_branch, head_branch));
    let review_branch = code_review_branch_name(base_branch, head_branch, pr_number);

    if !worktree_path.exists() {
        delete_review_branch_if_present(repo_path, &review_branch)?;
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
    delete_review_branch_if_present(repo_path, &review_branch)?;

    Ok(())
}

fn delete_review_branch_if_present(repo_path: &Path, review_branch: &str) -> Result<(), String> {
    if !review_branch.starts_with("review/") {
        return Ok(());
    }

    let ref_name = format!("refs/heads/{review_branch}");
    if run_git(
        repo_path,
        &[
            "show-ref".to_string(),
            "--verify".to_string(),
            "--quiet".to_string(),
            ref_name,
        ],
    )
    .is_err()
    {
        return Ok(());
    }

    run_git(
        repo_path,
        &[
            "branch".to_string(),
            "-D".to_string(),
            review_branch.to_string(),
        ],
    )?;

    Ok(())
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

fn fetch_gitee_git_auth(access_token: &str) -> Result<GiteeGitAuth, String> {
    let client = api_client("Gitee")?;
    let response = client
        .get("https://gitee.com/api/v5/user")
        .query(&[("access_token", access_token)])
        .send()
        .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;
    let user = parse_json_response(response)?;
    let username = first_string(&user, &[&["login"], &["username"], &["path"], &["name"]])
        .and_then(|value| clean_optional(&value))
        .ok_or_else(|| {
            "Could not resolve the Gitee username for git authentication.".to_string()
        })?;

    Ok(GiteeGitAuth {
        username,
        access_token: access_token.to_string(),
    })
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
        fs::remove_dir(path).map_err(|error| {
            format!(
                "Could not remove empty directory {}: {error}",
                path.display()
            )
        })?;
    }

    Ok(())
}

fn ensure_git_worktree(path: &Path) -> Result<(), String> {
    if is_git_worktree(path) {
        Ok(())
    } else {
        Err(format!(
            "Git worktree was not created at {}",
            path.display()
        ))
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
