use serde::Deserialize;

/// `repository::add_worktree` 的请求体。
///
/// `branch` 允许为空，因为这个命令既支持基于现有引用创建 worktree，也支持直接
/// 在目标路径上新建分支。
#[derive(Debug, Deserialize)]
pub(crate) struct AddWorktreeRequest {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) branch: Option<String>,
    pub(crate) create_branch: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RemoveWorktreeRequest {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) force: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenPathRequest {
    pub(crate) path: String,
    pub(crate) editor: String,
    pub(crate) custom_command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenUrlRequest {
    pub(crate) url: String,
    pub(crate) editor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReviewProviderListRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReviewProviderPullRequestRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

/// 审批、重置、测试通过等动作共用的请求体。
///
/// 后端会根据 `repo_path` 推导具体 provider 行为，因此请求层只需要携带仓库路径、
/// 认证信息和目标评审编号即可。
#[derive(Debug, Deserialize)]
pub(crate) struct ReviewProviderPullRequestActionRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReviewProviderCodeReviewRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

pub(crate) type GiteePullRequestListRequest = ReviewProviderListRequest;
pub(crate) type GiteePullRequestDetailRequest = ReviewProviderPullRequestRequest;
pub(crate) type GiteePullRequestActionRequest = ReviewProviderPullRequestActionRequest;
pub(crate) type GiteeCodeReviewRequest = ReviewProviderCodeReviewRequest;