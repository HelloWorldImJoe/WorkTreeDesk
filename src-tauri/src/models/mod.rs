//! 后端 DTO 聚合导出：集中暴露前后端 IPC 使用的数据结构。
mod git;
mod provider;
mod requests;
mod review;
mod scan;
mod update;

// 统一从这里重新导出后端 DTO，外部调用方仍然可以继续使用
// `crate::models::Type`。子模块拆分只改善文件组织，不改变既有引用方式。
pub(crate) use git::{GitHttpAuth, GitRemoteInfo, GiteeGitAuth, PullRequestBranchRef};
pub(crate) use provider::{
    GiteeRepositoryInfo, ReviewProviderCapabilities, ReviewProviderInfo, ReviewProviderKind,
};
pub(crate) use requests::{
    AddWorktreeRequest, CloneRepositoryRequest, GiteeCodeReviewRequest,
    GiteePullRequestActionRequest, GiteePullRequestDetailRequest, GiteePullRequestListRequest,
    OpenPathRequest, OpenUrlRequest, RemoveWorktreeRequest, ReviewProviderListRequest,
    ReviewProviderPullRequestCommentRequest, ReviewProviderPullRequestFileRequest,
    ReviewProviderPullRequestRequest,
};
pub(crate) use review::{
    CodeReviewResult, GiteePullRequestInfo, PullRequestChangedFileInfo, PullRequestCommitInfo,
    PullRequestFileContent, PullRequestFilePreview, PullRequestInfo, PullRequestPage,
    RepositoryMemberInfo,
};
pub(crate) use scan::{BranchInfo, RepositoryInfo, ScanResult, WorktreeInfo, WorktreeStatus};
pub(crate) use update::{InstallableUpdateMetadata, ReleaseCheckResult};
