//! GitLab 仓库 API：读取项目成员等仓库级数据。
use serde_json::Value;

use crate::models::ReviewProviderInfo;

use super::client::GitlabApiClient;

pub(crate) fn get_authenticated_user(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get("/user", Vec::new())
}

pub(crate) fn get_project(
    provider: &ReviewProviderInfo,
    access_token: &str,
    project_id: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token)
        .get(&format!("/projects/{project_id}"), Vec::new())
}

pub(crate) fn list_project_members(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/members/all",
            encode_gitlab_project_path(&provider.full_name)
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

fn encode_gitlab_project_path(project_path: &str) -> String {
    project_path.trim().trim_matches('/').replace('/', "%2F")
}
