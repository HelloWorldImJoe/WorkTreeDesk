use std::path::PathBuf;

use crate::{
    common::{clean_optional_string, expand_home},
    git::{git_stdout, paths_equal, run_git},
    models::{AddWorktreeRequest, RepositoryInfo, RemoveWorktreeRequest},
};

use super::{inspect_repository, parse_worktrees};

/// 负责 worktree 的增删、清理与刷新命令。
///
/// 这些命令在执行完 git 操作后都会重新读取仓库快照，保证前端无需自行拼接局部状态。
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