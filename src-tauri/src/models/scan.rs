use serde::Serialize;

use super::provider::{GiteeRepositoryInfo, ReviewProviderInfo};

/// 返回给前端的单个 worktree 快照。
///
/// 这个结构故意贴近 `git worktree list --porcelain` 的字段形式，方便仓库模块
/// 逐行解析后直接填充，避免在解析层和传输层之间再做一次无意义映射。
#[derive(Debug, Serialize)]
pub(crate) struct WorktreeInfo {
    pub(crate) path: String,
    pub(crate) head: Option<String>,
    pub(crate) branch: Option<String>,
    pub(crate) detached: bool,
    pub(crate) bare: bool,
    pub(crate) prunable: Option<String>,
    pub(crate) status: WorktreeStatus,
}

#[derive(Debug, Serialize, Default, Clone)]
pub(crate) struct WorktreeStatus {
    pub(crate) dirty: bool,
    pub(crate) staged: u32,
    pub(crate) unstaged: u32,
    pub(crate) untracked: u32,
    pub(crate) ahead: Option<u32>,
    pub(crate) behind: Option<u32>,
    pub(crate) summary: String,
}

/// 工作区页和评审流程共用的仓库聚合状态。
///
/// 前端刷新一个仓库卡片时，需要一次拿到 provider 信息、当前分支和所有 worktree，
/// 因此这里保持为仓库级别的核心传输对象，避免前端自己拼接多段状态。
#[derive(Debug, Serialize)]
pub(crate) struct RepositoryInfo {
    pub(crate) name: String,
    pub(crate) root: String,
    pub(crate) common_dir: String,
    pub(crate) provider: Option<ReviewProviderInfo>,
    pub(crate) gitee: Option<GiteeRepositoryInfo>,
    pub(crate) current_branch: Option<String>,
    pub(crate) worktrees: Vec<WorktreeInfo>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ScanResult {
    pub(crate) root: String,
    pub(crate) repositories: Vec<RepositoryInfo>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BranchInfo {
    pub(crate) name: String,
    pub(crate) upstream: Option<String>,
    pub(crate) remote: bool,
    pub(crate) current: bool,
}
