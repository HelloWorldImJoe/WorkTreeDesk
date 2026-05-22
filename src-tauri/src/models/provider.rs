use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReviewProviderKind {
    Gitee,
    Github,
    Gitlab,
}

/// 根据托管平台能力推导出的功能开关。
///
/// 各平台的评审、测试通过、重置等能力并不对称，因此后端在识别 provider 时就把
/// 能力集算出来，前端只根据能力渲染按钮，不再重复维护平台差异规则。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct ReviewProviderCapabilities {
    pub(crate) approve_review: bool,
    pub(crate) reset_review: bool,
    pub(crate) approve_test: bool,
    pub(crate) reset_test: bool,
    pub(crate) show_test_status: bool,
    pub(crate) reopen_pull_request: bool,
    pub(crate) close_pull_request: bool,
    pub(crate) merge_pull_request: bool,
    pub(crate) code_review: bool,
    pub(crate) cleanup_worktree: bool,
}

/// 仓库绑定的远端评审平台标准化描述。
///
/// PR API 请求、页面跳转、remote 匹配和 UI 标识都依赖同一组 host/owner/repo 数据。
/// 统一在这里标准化一次，后续功能模块就不必反复解析 remote URL。
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

// Gitee 是最早接入的平台，这个别名保留旧命名，避免评审命令调用链大面积改名。
pub(crate) type GiteeRepositoryInfo = ReviewProviderInfo;
