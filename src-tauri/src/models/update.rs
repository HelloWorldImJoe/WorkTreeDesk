use serde::Serialize;

/// 返回给前端的应用更新检查结果。
///
/// 更新提示既需要原始版本号，也需要发布标题、说明、时间等展示信息，因此后端直接
/// 组装成通用 DTO，而不是把 GitHub 的原始响应结构暴露给 Tauri 边界之外。
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
