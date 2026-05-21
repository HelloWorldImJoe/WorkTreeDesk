use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub(crate) struct WorktreeInfo {
    pub(crate) path: String,
    pub(crate) head: Option<String>,
    pub(crate) branch: Option<String>,
    pub(crate) detached: bool,
    pub(crate) bare: bool,
    pub(crate) prunable: Option<String>,
}

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

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReviewProviderKind {
    Gitee,
    Github,
    Gitlab,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ReviewProviderCapabilities {
    pub(crate) approve_review: bool,
    pub(crate) reset_review: bool,
    pub(crate) approve_test: bool,
    pub(crate) reset_test: bool,
    pub(crate) code_review: bool,
    pub(crate) cleanup_worktree: bool,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ReviewProviderInfo {
    pub(crate) kind: ReviewProviderKind,
    pub(crate) display_name: String,
    pub(crate) remote_name: String,
    pub(crate) host: String,
    pub(crate) owner: String,
    pub(crate) repo: String,
    pub(crate) full_name: String,
    pub(crate) web_url: String,
    pub(crate) clone_url: String,
    pub(crate) capabilities: ReviewProviderCapabilities,
}

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

pub(crate) type GiteeRepositoryInfo = ReviewProviderInfo;
pub(crate) type GiteePullRequestInfo = PullRequestInfo;

#[derive(Debug, Serialize)]
pub(crate) struct CodeReviewResult {
    pub(crate) worktree_path: String,
    pub(crate) review_branch: String,
    pub(crate) web_url: String,
}

#[derive(Debug, Clone)]
pub(crate) struct GitRemoteInfo {
    pub(crate) name: String,
    pub(crate) fetch_url: Option<String>,
    pub(crate) push_url: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PullRequestBranchRef {
    pub(crate) branch: String,
    pub(crate) repo_owner: Option<String>,
    pub(crate) repo_name: Option<String>,
    pub(crate) clone_url: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GitHttpAuth {
    pub(crate) username: String,
    pub(crate) access_token: String,
}

pub(crate) type GiteeGitAuth = GitHttpAuth;

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
pub(crate) struct GiteePullRequestListRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GiteePullRequestDetailRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GiteePullRequestActionRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GiteeCodeReviewRequest {
    pub(crate) repo_path: String,
    pub(crate) access_token: String,
    pub(crate) number: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReleaseCheckResult {
    pub(crate) current_version: String,
    pub(crate) latest_version: String,
    pub(crate) has_update: bool,
    pub(crate) release_name: Option<String>,
    pub(crate) release_notes: Option<String>,
    pub(crate) published_at: Option<String>,
    pub(crate) release_page_url: String,
}
