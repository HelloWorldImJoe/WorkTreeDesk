use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Serialize)]
struct WorktreeInfo {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
    bare: bool,
    prunable: Option<String>,
}

#[derive(Debug, Serialize)]
struct RepositoryInfo {
    name: String,
    root: String,
    common_dir: String,
    gitee: Option<GiteeRepositoryInfo>,
    current_branch: Option<String>,
    worktrees: Vec<WorktreeInfo>,
}

#[derive(Debug, Serialize)]
struct ScanResult {
    root: String,
    repositories: Vec<RepositoryInfo>,
}

#[derive(Debug, Serialize)]
struct BranchInfo {
    name: String,
    upstream: Option<String>,
    remote: bool,
    current: bool,
}

#[derive(Debug, Serialize, Clone)]
struct GiteeRepositoryInfo {
    remote_name: String,
    owner: String,
    repo: String,
    web_url: String,
    clone_url: String,
}

#[derive(Debug, Serialize)]
struct GiteePullRequestInfo {
    number: i64,
    title: String,
    body: Option<String>,
    author: String,
    author_avatar: Option<String>,
    state: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    web_url: String,
    source_branch: Option<String>,
    target_branch: Option<String>,
    source_repo: Option<String>,
    target_repo: Option<String>,
    review_status: Option<String>,
    test_status: Option<String>,
}

#[derive(Debug, Serialize)]
struct CodeReviewResult {
    worktree_path: String,
    review_branch: String,
    web_url: String,
}

#[derive(Debug, Clone)]
struct GitRemoteInfo {
    name: String,
    fetch_url: Option<String>,
    push_url: Option<String>,
}

#[derive(Debug, Clone)]
struct PullRequestBranchRef {
    branch: String,
    repo_owner: Option<String>,
    repo_name: Option<String>,
    clone_url: Option<String>,
}

#[derive(Debug, Clone)]
struct GiteeGitAuth {
    username: String,
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct AddWorktreeRequest {
    repo_path: String,
    worktree_path: String,
    branch: Option<String>,
    create_branch: bool,
}

#[derive(Debug, Deserialize)]
struct RemoveWorktreeRequest {
    repo_path: String,
    worktree_path: String,
    force: bool,
}

#[derive(Debug, Deserialize)]
struct OpenPathRequest {
    path: String,
    editor: String,
    custom_command: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenUrlRequest {
    url: String,
    editor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GiteePullRequestListRequest {
    repo_path: String,
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GiteePullRequestDetailRequest {
    repo_path: String,
    access_token: String,
    number: i64,
}

#[derive(Debug, Deserialize)]
struct GiteePullRequestActionRequest {
    repo_path: String,
    access_token: String,
    number: i64,
}

#[derive(Debug, Deserialize)]
struct GiteeCodeReviewRequest {
    repo_path: String,
    access_token: String,
    number: i64,
}

#[tauri::command]
fn scan_directory(root: String) -> Result<ScanResult, String> {
    let root_path = expand_home(&root)?;
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root_path.display()));
    }
    if !root_path.is_dir() {
        return Err(format!("Path is not a directory: {}", root_path.display()));
    }

    let mut repos: BTreeMap<String, RepositoryInfo> = BTreeMap::new();
    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_descend)
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_dir() {
            continue;
        }

        let candidate = entry.path();
        if !looks_like_git_repo(candidate) {
            continue;
        }

        if let Ok(repo) = inspect_repository(candidate) {
            repos.entry(repo.common_dir.clone()).or_insert(repo);
        }
    }

    Ok(ScanResult {
        root: root_path.to_string_lossy().to_string(),
        repositories: repos.into_values().collect(),
    })
}

#[tauri::command]
fn add_worktree(request: AddWorktreeRequest) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let worktree_path = expand_home(&request.worktree_path)?;
    let worktree_arg = worktree_path.to_string_lossy().to_string();

    let mut args = vec!["worktree".to_string(), "add".to_string()];

    let branch = clean_optional_string(&request.branch);
    if request.create_branch {
        if let Some(branch) = branch {
            args.push("-b".to_string());
            args.push(branch);
        }
        args.push(worktree_arg);
    } else {
        args.push(worktree_arg);
        if let Some(reference) = branch {
            args.push(reference);
        }
    }

    run_git(&repo_path, &args)?;
    inspect_repository(&repo_path)
}

#[tauri::command]
fn remove_worktree(request: RemoveWorktreeRequest) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let worktree_path = expand_home(&request.worktree_path)?;
    let mut args = vec![
        "worktree".to_string(),
        "remove".to_string(),
        worktree_path.to_string_lossy().to_string(),
    ];

    if request.force {
        args.push("--force".to_string());
    }

    run_git(&repo_path, &args)?;
    inspect_repository(&repo_path)
}

#[tauri::command]
fn prune_worktrees(repo_path: String) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&repo_path)?;
    run_git(
        &repo_path,
        &[
            "worktree".to_string(),
            "prune".to_string(),
            "--verbose".to_string(),
        ],
    )?;
    inspect_repository(&repo_path)
}

#[tauri::command]
fn refresh_repository(repo_path: String) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&repo_path)?;
    inspect_repository(&repo_path)
}

#[tauri::command]
fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let repo_path = expand_home(&repo_path)?;
    let output = git_stdout(
        &repo_path,
        &[
            "branch",
            "--all",
            "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)",
        ],
    )?;

    let mut branches = output
        .lines()
        .filter_map(parse_branch_line)
        .collect::<Vec<_>>();
    branches.sort_by(|left, right| {
        left.remote
            .cmp(&right.remote)
            .then_with(|| left.name.cmp(&right.name))
    });
    branches.dedup_by(|left, right| left.name == right.name);

    Ok(branches)
}

#[tauri::command]
fn open_path(request: OpenPathRequest) -> Result<(), String> {
    let path = expand_home(&request.path)?;
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    match request.editor.as_str() {
        "file-manager" | "finder" => open_file_manager(&path),
        "custom" => {
            let command = clean_optional_string(&request.custom_command)
                .ok_or_else(|| "Custom command is required.".to_string())?;
            run_process(&command, &[path_arg(&path)])
        }
        editor => open_editor(editor, &path),
    }
}

#[tauri::command]
fn open_url(request: OpenUrlRequest) -> Result<(), String> {
    let url = clean_required(&request.url, "URL")?;

    match request.editor.as_deref() {
        Some("vscode") => open_url_in_vscode(&url),
        _ => open_external_url(&url),
    }
}

#[tauri::command]
fn list_gitee_pull_requests(
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
fn get_gitee_pull_request_detail(
    request: GiteePullRequestDetailRequest,
) -> Result<GiteePullRequestInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = fetch_gitee_pull_request_value(&repo, &access_token, request.number)?;

    map_gitee_pull_request(&response, &repo)
}

#[tauri::command]
fn approve_gitee_pull_request_review(
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
fn approve_gitee_pull_request_test(
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
fn reset_gitee_pull_request_review(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}/review/reset", repo.owner, repo.repo, request.number),
        Vec::new(),
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
fn reset_gitee_pull_request_test(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;

    gitee_post(
        &access_token,
        &format!("/repos/{}/{}/pulls/{}/test/reset", repo.owner, repo.repo, request.number),
        Vec::new(),
    )?;

    inspect_repository(&repo_path)
}

#[tauri::command]
fn prepare_gitee_code_review(
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

    fs::create_dir_all(&code_review_root).map_err(|error| {
        format!(
            "Could not create CodeReview directory {}: {error}",
            code_review_root.display()
        )
    })?;

    fetch_branch_to_ref(
        &repo_path,
        &base_source,
        &base.branch,
        &base_ref,
        git_auth.as_ref(),
    )?;
    if worktree_path.exists() {
        if !is_git_worktree(&worktree_path) {
            if is_empty_directory(&worktree_path)? {
                fs::remove_dir(&worktree_path).map_err(|error| {
                    format!(
                        "Could not remove empty CodeReview directory {}: {error}",
                        worktree_path.display()
                    )
                })?;
            } else {
                return Err(format!(
                    "CodeReview path already exists and is not a git worktree: {}",
                    worktree_path.display()
                ));
            }
        }
    }

    if is_git_worktree(&worktree_path) {
        abort_merge_if_needed(&worktree_path)?;
        run_git(
            &worktree_path,
            &[
                "checkout".to_string(),
                "-B".to_string(),
                review_branch.clone(),
                base_ref.clone(),
            ],
        )?;
        run_git(
            &worktree_path,
            &[
                "reset".to_string(),
                "--hard".to_string(),
                base_ref.clone(),
            ],
        )?;
        run_git(
            &worktree_path,
            &["clean".to_string(), "-fd".to_string()],
        )?;
    } else {
        run_git(
            &repo_path,
            &[
                "worktree".to_string(),
                "prune".to_string(),
                "--verbose".to_string(),
            ],
        )?;
        run_git(
            &repo_path,
            &[
                "worktree".to_string(),
                "add".to_string(),
                "-B".to_string(),
                review_branch.clone(),
                path_arg(&worktree_path),
                base_ref.clone(),
            ],
        )?;
        ensure_git_worktree(&worktree_path)?;
    }

    fetch_branch_to_ref(
        &repo_path,
        &head_source,
        &head.branch,
        &head_ref,
        git_auth.as_ref(),
    )?;
    merge_ref_without_staging(&worktree_path, &head_ref)?;

    Ok(CodeReviewResult {
        worktree_path: path_arg(&worktree_path),
        review_branch,
        web_url: extract_pull_request_web_url(&response)
            .unwrap_or_else(|| format!("{}/pulls/{}", repo.web_url, request.number)),
    })
}

#[tauri::command]
fn cleanup_gitee_code_review_worktree(
    request: GiteePullRequestActionRequest,
) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let repo = require_gitee_repository(&repo_path)?;
    let access_token = require_access_token(&request.access_token)?;
    let response = fetch_gitee_pull_request_value(&repo, &access_token, request.number)?;

    cleanup_gitee_code_review(&repo_path, request.number, &response)?;

    inspect_repository(&repo_path)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            add_worktree,
            remove_worktree,
            prune_worktrees,
            refresh_repository,
            list_branches,
            open_path,
            open_url,
            list_gitee_pull_requests,
            get_gitee_pull_request_detail,
            approve_gitee_pull_request_review,
            approve_gitee_pull_request_test,
            reset_gitee_pull_request_review,
            reset_gitee_pull_request_test,
            prepare_gitee_code_review,
            cleanup_gitee_code_review_worktree
        ])
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn inspect_repository(path: &Path) -> Result<RepositoryInfo, String> {
    let root = git_stdout(path, &["rev-parse", "--show-toplevel"])?;
    let common_dir_raw = git_stdout(path, &["rev-parse", "--git-common-dir"])?;
    let common_dir = normalize_git_path(path, &common_dir_raw);
    let current_branch = git_stdout(path, &["branch", "--show-current"])
        .ok()
        .and_then(|value| clean_optional(&value));
    let porcelain = git_stdout(path, &["worktree", "list", "--porcelain"])?;

    Ok(RepositoryInfo {
        name: repository_name(&common_dir),
        root,
        common_dir,
        gitee: detect_gitee_repository(path),
        current_branch,
        worktrees: parse_worktrees(&porcelain),
    })
}

fn parse_worktrees(output: &str) -> Vec<WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current: Option<WorktreeInfo> = None;

    for line in output.lines() {
        if line.trim().is_empty() {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            current = Some(WorktreeInfo {
                path: path.to_string(),
                head: None,
                branch: None,
                detached: false,
                bare: false,
                prunable: None,
            });
            continue;
        }

        if let Some(worktree) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                worktree.head = Some(head.to_string());
            } else if let Some(branch) = line.strip_prefix("branch ") {
                worktree.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            } else if line == "detached" {
                worktree.detached = true;
            } else if line == "bare" {
                worktree.bare = true;
            } else if let Some(reason) = line.strip_prefix("prunable ") {
                worktree.prunable = Some(reason.to_string());
            }
        }
    }

    if let Some(worktree) = current {
        worktrees.push(worktree);
    }

    worktrees
}

fn parse_branch_line(line: &str) -> Option<BranchInfo> {
    let mut parts = line.split('\t');
    let current_marker = parts.next().unwrap_or_default().trim();
    let raw_name = parts.next()?.trim();
    let upstream = parts.next().and_then(clean_optional);

    if raw_name.is_empty() || raw_name == "HEAD" || raw_name.contains("HEAD ->") {
        return None;
    }

    let remote = raw_name.starts_with("remotes/");
    let name = raw_name.trim_start_matches("remotes/").to_string();

    Some(BranchInfo {
        name,
        upstream,
        remote,
        current: current_marker == "*",
    })
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
    let title = first_string(value, &[&["title"]]).unwrap_or_else(|| format!("PR #{}", number));
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
        .ok_or_else(|| format!("Gitee PR is missing the {role} branch."))?;
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
    fallback_repo: &GiteeRepositoryInfo,
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

fn fetch_source_uses_gitee_https(repo_path: &Path, source: &str) -> bool {
    resolve_fetch_source_url(repo_path, source)
        .as_deref()
        .is_some_and(is_gitee_https_url)
}

fn resolve_fetch_source_url(repo_path: &Path, source: &str) -> Option<String> {
    let source = source.trim();
    if is_gitee_https_url(source) {
        return Some(source.to_string());
    }

    list_git_remotes(repo_path)
        .ok()?
        .into_iter()
        .find(|remote| remote.name == source)
        .and_then(|remote| remote.fetch_url.or(remote.push_url))
}

fn gitee_git_auth_header(auth: &GiteeGitAuth) -> String {
    let credentials = STANDARD.encode(format!("{}:{}", auth.username, auth.access_token));
    format!("Authorization: Basic {credentials}")
}

fn fetch_branch_to_ref(
    repo_path: &Path,
    source: &str,
    branch_name: &str,
    destination_ref: &str,
    git_auth: Option<&GiteeGitAuth>,
) -> Result<(), String> {
    let branch_name = normalize_branch_name(branch_name);
    let mut args = Vec::new();

    if fetch_source_uses_gitee_https(repo_path, source) {
        if let Some(auth) = git_auth {
            args.push("-c".to_string());
            args.push(format!("http.extraHeader={}", gitee_git_auth_header(auth)));
            args.push("-c".to_string());
            args.push("credential.interactive=false".to_string());
        }
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

fn cleanup_gitee_code_review(repo_path: &Path, pr_number: i64, response: &Value) -> Result<(), String> {
    let base = extract_pull_request_branch_ref(response, "base")?;
    let head = extract_pull_request_branch_ref(response, "head")?;
    let code_review_root = code_review_root(repo_path)?;
    let worktree_path = code_review_root.join(code_review_worktree_name(&base.branch, &head.branch));

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

fn require_gitee_repository(repo_path: &Path) -> Result<GiteeRepositoryInfo, String> {
    detect_gitee_repository(repo_path).ok_or_else(|| {
        format!(
            "This repository does not have a Gitee remote. Add a gitee.com remote first: {}",
            repo_path.display()
        )
    })
}

fn detect_gitee_repository(repo_path: &Path) -> Option<GiteeRepositoryInfo> {
    let mut remotes = list_git_remotes(repo_path).ok()?;
    remotes.sort_by_key(|remote| if remote.name == "origin" { 0 } else { 1 });

    remotes.into_iter().find_map(|remote| {
        let url = remote.fetch_url.clone().or(remote.push_url.clone())?;
        let (owner, repo) = parse_gitee_remote_url(&url)?;

        Some(GiteeRepositoryInfo {
            remote_name: remote.name,
            owner: owner.clone(),
            repo: repo.clone(),
            web_url: format!("https://gitee.com/{owner}/{repo}"),
            clone_url: format!("https://gitee.com/{owner}/{repo}.git"),
        })
    })
}

fn list_git_remotes(repo_path: &Path) -> Result<Vec<GitRemoteInfo>, String> {
    let output = git_stdout(repo_path, &["remote", "-v"])?;
    let mut remotes: BTreeMap<String, GitRemoteInfo> = BTreeMap::new();

    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or_default().trim();
        let url = parts.next().unwrap_or_default().trim();
        let kind = parts
            .next()
            .unwrap_or_default()
            .trim()
            .trim_start_matches('(')
            .trim_end_matches(')');

        if name.is_empty() || url.is_empty() {
            continue;
        }

        let entry = remotes.entry(name.to_string()).or_insert(GitRemoteInfo {
            name: name.to_string(),
            fetch_url: None,
            push_url: None,
        });

        match kind {
            "fetch" => entry.fetch_url = Some(url.to_string()),
            "push" => entry.push_url = Some(url.to_string()),
            _ => {}
        }
    }

    Ok(remotes.into_values().collect())
}

fn find_remote_name_for_repo(repo_path: &Path, owner: &str, repo: &str) -> Option<String> {
    list_git_remotes(repo_path)
        .ok()?
        .into_iter()
        .find_map(|remote| {
            let url = remote.fetch_url.as_deref().or(remote.push_url.as_deref())?;
            let (remote_owner, remote_repo) = parse_gitee_remote_url(url)?;
            if remote_owner == owner && remote_repo == repo {
                Some(remote.name)
            } else {
                None
            }
        })
}

fn parse_gitee_remote_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches('/');
    let path = if let Some(rest) = trimmed.strip_prefix("git@gitee.com:") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@gitee.com/") {
        rest
    } else if let Some(rest) = gitee_https_path(trimmed) {
        rest
    } else {
        return None;
    };

    split_owner_repo(path)
}

fn gitee_https_path(url: &str) -> Option<&str> {
    let trimmed = url.trim().trim_end_matches('/');
    let remainder = if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else {
        return None;
    };

    let without_userinfo = remainder.rsplit_once('@').map(|(_, rest)| rest).unwrap_or(remainder);
    without_userinfo.strip_prefix("gitee.com/")
}

fn is_gitee_https_url(url: &str) -> bool {
    gitee_https_path(url).is_some()
}

fn split_owner_repo(path: &str) -> Option<(String, String)> {
    let cleaned = path.trim().trim_matches('/').trim_end_matches(".git");
    let mut segments = cleaned.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?.to_string();
    let repo = segments.next()?.to_string();
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
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("WorktreeDesk/0.1")
        .build()
        .map_err(|error| format!("Could not initialize Gitee client: {error}"))
}

fn parse_json_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read Gitee response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Gitee API returned {}: {}",
            status,
            summarize_api_error(&body)
        ));
    }

    if body.trim().is_empty() {
        return Ok(Value::Null);
    }

    serde_json::from_str(&body).map_err(|error| format!("Could not parse Gitee response: {error}"))
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
            extract_repo_owner(value, role).zip(extract_repo_name(value, role)).map(|(owner, repo)| {
                format!("{owner}/{repo}")
            })
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
            extract_repo_owner(value, role).zip(extract_repo_name(value, role)).map(|(owner, repo)| {
                format!("{owner}/{repo}")
            })
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
            extract_repo_full_name(value, role).and_then(|full_name| split_owner_repo(&full_name).map(|(owner, _)| owner))
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
            extract_repo_full_name(value, role).and_then(|full_name| split_owner_repo(&full_name).map(|(owner, _)| owner))
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
            extract_repo_full_name(value, role).and_then(|full_name| split_owner_repo(&full_name).map(|(_, repo)| repo))
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
            extract_repo_full_name(value, role).and_then(|full_name| split_owner_repo(&full_name).map(|(_, repo)| repo))
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
    first_string(
        value,
        &[
            &["html_url"],
            &["htmlUrl"],
            &["url"],
            &["web_url"],
        ],
    )
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

fn require_access_token(access_token: &str) -> Result<String, String> {
    clean_required(access_token, "Gitee API Key")
}

fn clean_required(value: &str, field_name: &str) -> Result<String, String> {
    clean_optional(value).ok_or_else(|| format!("{field_name} is required."))
}

fn looks_like_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

fn should_descend(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    !matches!(
        name.as_ref(),
        ".git" | "node_modules" | "target" | "dist" | ".next" | ".turbo"
    )
}

fn run_git(repo_path: &Path, args: &[String]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn git_stdout(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    run_git(repo_path, &args)
}

fn run_process(command: &str, args: &[String]) -> Result<(), String> {
    let status = Command::new(command)
        .args(args)
        .status()
        .map_err(|error| format!("Failed to launch {command}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("{command} exited with status {status}"))
    }
}

fn open_file_manager(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        run_process("explorer", &[path_arg(path)])
    } else if cfg!(target_os = "macos") {
        run_process("open", &[path_arg(path)])
    } else {
        run_process("xdg-open", &[path_arg(path)])
    }
}

fn open_editor(editor: &str, path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        if let Some(app_name) = mac_editor_app(editor) {
            if run_process("open", &["-a".into(), app_name.into(), path_arg(path)]).is_ok() {
                return Ok(());
            }
        }
    }

    let mut errors = Vec::new();
    for command in editor_commands(editor) {
        match run_process(command, &[path_arg(path)]) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    if editor_commands(editor).is_empty() && mac_editor_app(editor).is_none() {
        Err(format!("Unsupported editor: {editor}"))
    } else {
        Err(format!(
            "Could not launch editor `{editor}`. Tried: {}",
            errors.join("; ")
        ))
    }
}

fn open_external_url(url: &str) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        run_process("explorer", &[url.to_string()])
    } else if cfg!(target_os = "macos") {
        run_process("open", &[url.to_string()])
    } else {
        run_process("xdg-open", &[url.to_string()])
    }
}

fn open_url_in_vscode(url: &str) -> Result<(), String> {
    if run_process("code", &["--open-url".to_string(), url.to_string()]).is_ok() {
        return Ok(());
    }

    if cfg!(target_os = "macos")
        && run_process(
            "open",
            &[
                "-a".to_string(),
                "Visual Studio Code".to_string(),
                url.to_string(),
            ],
        )
        .is_ok()
    {
        return Ok(());
    }

    open_external_url(url)
}

#[cfg(test)]
mod tests {
    use super::{
        code_review_branch_name, code_review_worktree_name, gitee_https_path,
        parse_gitee_remote_url,
    };

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

    #[test]
    fn parse_gitee_remote_url_supports_https_userinfo() {
        assert_eq!(
            parse_gitee_remote_url("https://user:token@gitee.com/team/repo.git"),
            Some(("team".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn gitee_https_path_strips_optional_userinfo() {
        assert_eq!(
            gitee_https_path("https://user@gitee.com/team/repo.git"),
            Some("team/repo.git")
        );
    }
}

fn mac_editor_app(editor: &str) -> Option<&'static str> {
    match editor {
        "vscode" => Some("Visual Studio Code"),
        "cursor" => Some("Cursor"),
        "windsurf" => Some("Windsurf"),
        "zed" => Some("Zed"),
        "sublime" => Some("Sublime Text"),
        "webstorm" => Some("WebStorm"),
        "idea" => Some("IntelliJ IDEA"),
        "pycharm" => Some("PyCharm"),
        "goland" => Some("GoLand"),
        "phpstorm" => Some("PhpStorm"),
        "clion" => Some("CLion"),
        "rider" => Some("Rider"),
        "android-studio" => Some("Android Studio"),
        "xcode" => Some("Xcode"),
        "nova" => Some("Nova"),
        "textmate" => Some("TextMate"),
        "emacs" => Some("Emacs"),
        _ => None,
    }
}

fn editor_commands(editor: &str) -> &'static [&'static str] {
    match editor {
        "vscode" => &["code"],
        "cursor" => &["cursor"],
        "windsurf" => &["windsurf"],
        "zed" => &["zed"],
        "sublime" => &["subl", "sublime_text"],
        "webstorm" => &["webstorm", "webstorm64"],
        "idea" => &["idea", "idea64"],
        "pycharm" => &["pycharm", "pycharm64"],
        "goland" => &["goland", "goland64"],
        "phpstorm" => &["phpstorm", "phpstorm64"],
        "clion" => &["clion", "clion64"],
        "rider" => &["rider", "rider64"],
        "android-studio" => &["studio", "studio64", "android-studio"],
        "xcode" => &["xed"],
        "nova" => &["nova"],
        "textmate" => &["mate"],
        "emacs" => &["emacs", "runemacs"],
        _ => &[],
    }
}

fn expand_home(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Path is required.".to_string());
    }

    if path == "~" {
        return home_dir().ok_or_else(|| "Could not resolve home directory.".to_string());
    }

    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| "Could not resolve home directory.".to_string());
    }

    Ok(PathBuf::from(path))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn normalize_git_path(repo_path: &Path, path: &str) -> String {
    let parsed = PathBuf::from(path);
    if parsed.is_absolute() {
        parsed.to_string_lossy().to_string()
    } else {
        repo_path.join(parsed).to_string_lossy().to_string()
    }
}

fn repository_name(common_dir: &str) -> String {
    let path = Path::new(common_dir);
    if path.file_name().and_then(|name| name.to_str()) == Some(".git") {
        return path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or(common_dir)
            .to_string();
    }

    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or(common_dir)
        .to_string()
}

fn clean_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn clean_optional_string(value: &Option<String>) -> Option<String> {
    value.as_deref().and_then(clean_optional)
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
