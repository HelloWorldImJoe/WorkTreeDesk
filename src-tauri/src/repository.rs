use std::{collections::BTreeMap, path::{Path, PathBuf}};

use walkdir::{DirEntry, WalkDir};

use crate::{
    common::{clean_optional, clean_optional_string, expand_home, normalize_git_path, repository_name},
    git::{git_stdout, paths_equal, run_git},
    models::{AddWorktreeRequest, BranchInfo, RepositoryInfo, RemoveWorktreeRequest, ScanResult, WorktreeInfo},
    provider::detect_review_provider,
};

#[tauri::command]
pub(crate) fn scan_directory(root: String) -> Result<ScanResult, String> {
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
pub(crate) fn add_worktree(request: AddWorktreeRequest) -> Result<RepositoryInfo, String> {
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
pub(crate) fn remove_worktree(request: RemoveWorktreeRequest) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let worktree_path = expand_home(&request.worktree_path)?;
    let command_repo_path = if paths_equal(&repo_path, &worktree_path) {
        let porcelain = git_stdout(&repo_path, &["worktree", "list", "--porcelain"])?;
        parse_worktrees(&porcelain)
            .into_iter()
            .map(|worktree| PathBuf::from(worktree.path))
            .find(|candidate| !paths_equal(candidate, &worktree_path))
            .ok_or_else(|| "At least one worktree must remain.".to_string())?
    } else {
        repo_path.clone()
    };

    let mut args = vec![
        "worktree".to_string(),
        "remove".to_string(),
        worktree_path.to_string_lossy().to_string(),
    ];

    if request.force {
        args.push("--force".to_string());
    }

    run_git(&command_repo_path, &args)?;
    inspect_repository(&command_repo_path)
}

#[tauri::command]
pub(crate) fn prune_worktrees(repo_path: String) -> Result<RepositoryInfo, String> {
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
pub(crate) fn refresh_repository(repo_path: String) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&repo_path)?;
    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
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

pub(crate) fn inspect_repository(path: &Path) -> Result<RepositoryInfo, String> {
    let root = git_stdout(path, &["rev-parse", "--show-toplevel"])?;
    let common_dir_raw = git_stdout(path, &["rev-parse", "--git-common-dir"])?;
    let common_dir = normalize_git_path(path, &common_dir_raw);
    let current_branch = git_stdout(path, &["branch", "--show-current"])
        .ok()
        .and_then(|value| clean_optional(&value));
    let porcelain = git_stdout(path, &["worktree", "list", "--porcelain"])?;
    let provider = detect_review_provider(path);
    let gitee = provider
        .clone()
        .filter(|entry| entry.kind == crate::models::ReviewProviderKind::Gitee);

    Ok(RepositoryInfo {
        name: repository_name(&common_dir),
        root,
        common_dir,
        provider,
        gitee,
        current_branch,
        worktrees: parse_worktrees(&porcelain),
    })
}

pub(crate) fn parse_worktrees(output: &str) -> Vec<WorktreeInfo> {
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
