//! 仓库功能模块：扫描仓库和管理 Git Worktree。
pub(crate) mod scan;
pub(crate) mod worktree;

// 非 Tauri 命令的公共辅助函数仍然从模块根导出，便于其他后端模块复用。
pub(crate) use scan::{inspect_repository, parse_worktrees};
