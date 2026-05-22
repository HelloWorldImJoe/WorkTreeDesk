use std::path::PathBuf;

use crate::{
    common::{clean_optional, clean_optional_string, clean_required, expand_home, run_blocking},
    git::{git_clone, git_stdout, paths_equal, run_git},
    models::{AddWorktreeRequest, CloneRepositoryRequest, RemoveWorktreeRequest, RepositoryInfo},
};

use super::{inspect_repository, parse_worktrees};

/// 负责 worktree 的增删、清理与刷新命令。
///
/// 这些命令在执行完 git 操作后都会重新读取仓库快照，保证前端无需自行拼接局部状态。
#[tauri::command]
pub(crate) async fn add_worktree(request: AddWorktreeRequest) -> Result<RepositoryInfo, String> {
    run_blocking(move || add_worktree_sync(request)).await
}

fn add_worktree_sync(request: AddWorktreeRequest) -> Result<RepositoryInfo, String> {
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
pub(crate) async fn remove_worktree(
    request: RemoveWorktreeRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || remove_worktree_sync(request)).await
}

fn remove_worktree_sync(request: RemoveWorktreeRequest) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&request.repo_path)?;
    let worktree_path = expand_home(&request.worktree_path)?;
    let review_branch = review_branch_for_worktree(&repo_path, &worktree_path);
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
    if let Some(branch) = review_branch {
        delete_review_branch_if_present(&command_repo_path, &branch)?;
    }
    inspect_repository(&command_repo_path)
}

#[tauri::command]
pub(crate) async fn prune_worktrees(repo_path: String) -> Result<RepositoryInfo, String> {
    run_blocking(move || prune_worktrees_sync(repo_path)).await
}

fn prune_worktrees_sync(repo_path: String) -> Result<RepositoryInfo, String> {
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
pub(crate) async fn refresh_repository(repo_path: String) -> Result<RepositoryInfo, String> {
    run_blocking(move || refresh_repository_sync(repo_path)).await
}

fn refresh_repository_sync(repo_path: String) -> Result<RepositoryInfo, String> {
    let repo_path = expand_home(&repo_path)?;
    inspect_repository(&repo_path)
}

#[tauri::command]
pub(crate) async fn clone_repository(
    request: CloneRepositoryRequest,
) -> Result<RepositoryInfo, String> {
    run_blocking(move || clone_repository_sync(request)).await
}

fn clone_repository_sync(request: CloneRepositoryRequest) -> Result<RepositoryInfo, String> {
    let remote_url = clean_required(&request.remote_url, "Remote URL")?;
    let parent_dir = expand_home(&request.parent_dir)?;
    if !parent_dir.exists() {
        return Err(format!(
            "Parent directory does not exist: {}",
            parent_dir.display()
        ));
    }
    if !parent_dir.is_dir() {
        return Err(format!(
            "Parent path is not a directory: {}",
            parent_dir.display()
        ));
    }

    let directory_name = clean_optional_string(&request.directory_name)
        .or_else(|| infer_repository_directory(&remote_url))
        .ok_or_else(|| "Could not infer repository directory name.".to_string())?;
    let target_path = parent_dir.join(directory_name);

    if target_path.exists() {
        return Err(format!(
            "Target path already exists: {}",
            target_path.display()
        ));
    }

    git_clone(&remote_url, &target_path)?;
    inspect_repository(&target_path)
}

fn infer_repository_directory(remote_url: &str) -> Option<String> {
    let normalized = remote_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");
    normalized
        .rsplit(['/', ':'])
        .next()
        .and_then(clean_optional)
        .map(|value| value.replace(' ', "-"))
}

fn review_branch_for_worktree(
    repo_path: &std::path::Path,
    worktree_path: &std::path::Path,
) -> Option<String> {
    let porcelain = git_stdout(repo_path, &["worktree", "list", "--porcelain"]).ok()?;
    parse_worktrees(&porcelain)
        .into_iter()
        .find(|worktree| paths_equal(std::path::Path::new(&worktree.path), worktree_path))
        .and_then(|worktree| worktree.branch)
        .filter(|branch| branch.starts_with("review/") && branch.contains("/pr-"))
}

fn delete_review_branch_if_present(
    repo_path: &std::path::Path,
    branch: &str,
) -> Result<(), String> {
    let ref_name = format!("refs/heads/{branch}");
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
        &["branch".to_string(), "-D".to_string(), branch.to_string()],
    )?;

    Ok(())
}
