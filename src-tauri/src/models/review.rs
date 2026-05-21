use serde::Serialize;

/// 跨平台统一后的 Pull Request / Merge Request 数据。
///
/// Gitee、GitHub、GitLab 的字段命名和审批语义并不一致，评审模块会先把各平台
/// 响应映射成这个结构，前端才能使用同一套列表和详情视图。
#[derive(Debug, Serialize)]
pub(crate) struct PullRequestInfo {
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) body: Option<String>,
    pub(crate) author: String,
    pub(crate) author_avatar: Option<String>,
    pub(crate) state: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) web_url: String,
    pub(crate) source_branch: Option<String>,
    pub(crate) target_branch: Option<String>,
    pub(crate) source_repo: Option<String>,
    pub(crate) target_repo: Option<String>,
    pub(crate) review_status: Option<String>,
    pub(crate) test_status: Option<String>,
    pub(crate) review_action_allowed: Option<bool>,
    pub(crate) review_action_blocked_reason: Option<String>,
}

pub(crate) type GiteePullRequestInfo = PullRequestInfo;

/// 创建专用代码评审 worktree 后返回的结果。
///
/// UI 既需要本地路径来打开目录，也需要远端链接直接跳到评审页面，因此这里把两者
/// 一起作为命令返回值，避免前端再做额外查询。
#[derive(Debug, Serialize)]
pub(crate) struct CodeReviewResult {
    pub(crate) worktree_path: String,
    pub(crate) review_branch: String,
    pub(crate) web_url: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RepositoryMemberInfo {
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) avatar_url: Option<String>,
    pub(crate) profile_url: Option<String>,
    pub(crate) role_name: Option<String>,
    pub(crate) permission: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PullRequestCommitInfo {
    pub(crate) sha: String,
    pub(crate) message: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) authored_at: Option<String>,
    pub(crate) web_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PullRequestChangedFileInfo {
    pub(crate) filename: String,
    pub(crate) status: Option<String>,
    pub(crate) additions: Option<i64>,
    pub(crate) deletions: Option<i64>,
    pub(crate) changes: Option<i64>,
    pub(crate) blob_url: Option<String>,
    pub(crate) raw_url: Option<String>,
    pub(crate) patch: Option<String>,
}