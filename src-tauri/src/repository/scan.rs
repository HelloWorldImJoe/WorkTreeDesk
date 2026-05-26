//! 仓库扫描命令：发现 Git 仓库、解析 worktree 列表和状态。
use std::{collections::BTreeMap, path::Path};

use walkdir::{DirEntry, WalkDir};

use crate::{
    common::{clean_optional, expand_home, normalize_git_path, repository_name, run_blocking},
    git::git_stdout,
    models::{BranchInfo, RepositoryInfo, ScanResult, WorktreeInfo, WorktreeStatus},
    provider::detect_review_provider,
};

/// 扫描目录下的 Git 仓库，并把同一 common dir 的 worktree 聚合成一个仓库条目。
///
/// 前端工作区页需要的是“仓库视角”的列表，而不是把每个 worktree 当成独立仓库。
/// 因此这里先递归发现候选目录，再通过 common_dir 去重，保证 UI 展示稳定。
#[tauri::command]
pub(crate) async fn scan_directory(root: String) -> Result<ScanResult, String> {
    run_blocking(move || scan_directory_sync(root)).await
}

fn scan_directory_sync(root: String) -> Result<ScanResult, String> {
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
pub(crate) async fn inspect_path(path: String) -> Result<RepositoryInfo, String> {
    run_blocking(move || inspect_path_sync(path)).await
}

fn inspect_path_sync(path: String) -> Result<RepositoryInfo, String> {
    let path = expand_home(&path)?;
    inspect_repository(&path)
}

#[tauri::command]
pub(crate) async fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    run_blocking(move || list_branches_sync(repo_path)).await
}

fn list_branches_sync(repo_path: String) -> Result<Vec<BranchInfo>, String> {
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

/// 读取 Git 元数据并组装前端需要的仓库快照。
///
/// 这里集中做一次 provider 探测、当前分支读取和 worktree 解析，避免其他命令
/// 在成功执行后还要分别重复拼装这些字段。
pub(crate) fn inspect_repository(path: &Path) -> Result<RepositoryInfo, String> {
    let root = git_stdout(path, &["rev-parse", "--show-toplevel"])?;
    let common_dir_raw = git_stdout(path, &["rev-parse", "--git-common-dir"])?;
    let common_dir = normalize_git_path(path, &common_dir_raw);
    let current_branch = git_stdout(path, &["branch", "--show-current"])
        .ok()
        .and_then(|value| clean_optional(&value));
    let porcelain = git_stdout(path, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = parse_worktrees(&porcelain);
    for worktree in &mut worktrees {
        worktree.status = read_worktree_status(Path::new(&worktree.path));
    }
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
        worktrees,
    })
}

/// 解析 `git worktree list --porcelain` 输出。
///
/// 使用 git 的 porcelain 格式是为了避免依赖人类可读输出的列宽或语言环境，字段名
/// 与 WorktreeInfo 一一对应，后续命令也能直接复用这个解析结果。
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
                status: WorktreeStatus::default(),
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

fn read_worktree_status(path: &Path) -> WorktreeStatus {
    if !path.exists() {
        return WorktreeStatus {
            dirty: true,
            summary: "missing".to_string(),
            ..WorktreeStatus::default()
        };
    }

    let output = match git_stdout(path, &["status", "--short", "--branch"]) {
        Ok(output) => output,
        Err(_) => {
            return WorktreeStatus {
                summary: "unknown".to_string(),
                ..WorktreeStatus::default()
            }
        }
    };

    let mut status = WorktreeStatus::default();
    for line in output.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            parse_ahead_behind(branch_line, &mut status);
            continue;
        }

        let code = line.get(0..2).unwrap_or_default();
        let staged = code.chars().next().unwrap_or(' ');
        let unstaged = code.chars().nth(1).unwrap_or(' ');

        if code == "??" {
            status.untracked += 1;
        } else {
            if staged != ' ' {
                status.staged += 1;
            }
            if unstaged != ' ' {
                status.unstaged += 1;
            }
        }
    }

    status.dirty = status.staged > 0 || status.unstaged > 0 || status.untracked > 0;
    status.summary = summarize_status(&status);
    status
}

fn parse_ahead_behind(line: &str, status: &mut WorktreeStatus) {
    let Some(metadata) = line
        .split_once('[')
        .and_then(|(_, rest)| rest.split_once(']'))
    else {
        return;
    };

    for part in metadata.0.split(',') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("ahead ") {
            status.ahead = value.parse().ok();
        } else if let Some(value) = part.strip_prefix("behind ") {
            status.behind = value.parse().ok();
        }
    }
}

fn summarize_status(status: &WorktreeStatus) -> String {
    if !status.dirty {
        return "clean".to_string();
    }

    let mut parts = Vec::new();
    if status.staged > 0 {
        parts.push(format!("{} staged", status.staged));
    }
    if status.unstaged > 0 {
        parts.push(format!("{} changed", status.unstaged));
    }
    if status.untracked > 0 {
        parts.push(format!("{} untracked", status.untracked));
    }
    parts.join(", ")
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
