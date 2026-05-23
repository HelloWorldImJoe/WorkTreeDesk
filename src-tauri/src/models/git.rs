//! Git 相关 DTO：远端、认证和分支引用等结构。
#[derive(Debug, Clone)]
pub(crate) struct GitRemoteInfo {
    pub(crate) name: String,
    pub(crate) fetch_url: Option<String>,
    pub(crate) push_url: Option<String>,
}

/// 从远端 PR/MR 落地评审 worktree 所需的最小分支引用信息。
///
/// 平台 API 返回的分支元数据未必和本地 remote 一一对应，因此评审流程先把它整理成
/// 这个中间结构，再决定是复用本地 remote，还是直接使用平台返回的 clone URL。
#[derive(Debug, Clone)]
pub(crate) struct PullRequestBranchRef {
    pub(crate) branch: String,
    pub(crate) repo_owner: Option<String>,
    pub(crate) repo_name: Option<String>,
    pub(crate) clone_url: Option<String>,
}

/// 供平台 REST 调用和带鉴权 clone URL 复用的 HTTP 认证信息。
#[derive(Debug, Clone)]
pub(crate) struct GitHttpAuth {
    pub(crate) username: String,
    pub(crate) access_token: String,
}

pub(crate) type GiteeGitAuth = GitHttpAuth;
