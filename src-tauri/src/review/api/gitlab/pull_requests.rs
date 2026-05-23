use serde_json::Value;

use crate::models::ReviewProviderInfo;

use super::client::GitlabApiClient;

pub(crate) fn list_merge_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
    state: &str,
    page: u32,
    per_page: u32,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/merge_requests",
            encode_gitlab_project_path(&provider.full_name)
        ),
        vec![
            ("state".to_string(), state.to_string()),
            ("order_by".to_string(), "updated_at".to_string()),
            ("sort".to_string(), "desc".to_string()),
            ("page".to_string(), page.to_string()),
            ("per_page".to_string(), per_page.to_string()),
        ],
    )
}

pub(crate) fn get_merge_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/merge_requests/{number}",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )
}

pub(crate) fn get_merge_request_approvals(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/merge_requests/{number}/approvals",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )
}

pub(crate) fn list_merge_request_commits(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/merge_requests/{number}/commits",
            encode_gitlab_project_path(&provider.full_name)
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn list_merge_request_changes(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).get(
        &format!(
            "/projects/{}/merge_requests/{number}/changes",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )
}

pub(crate) fn approve_merge_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).post(&format!(
        "/projects/{}/merge_requests/{number}/approve",
        encode_gitlab_project_path(&provider.full_name)
    ))
}

pub(crate) fn create_merge_request_comment(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
    body: &str,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).post_form(
        &format!(
            "/projects/{}/merge_requests/{number}/notes",
            encode_gitlab_project_path(&provider.full_name)
        ),
        vec![("body".to_string(), body.to_string())],
    )
}

pub(crate) fn unapprove_merge_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).post(&format!(
        "/projects/{}/merge_requests/{number}/unapprove",
        encode_gitlab_project_path(&provider.full_name)
    ))
}

pub(crate) fn update_merge_request_state(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
    state_event: &str,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).put(
        &format!(
            "/projects/{}/merge_requests/{number}",
            encode_gitlab_project_path(&provider.full_name)
        ),
        vec![("state_event".to_string(), state_event.to_string())],
    )
}

pub(crate) fn merge_merge_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GitlabApiClient::new(&provider.host, access_token).put(
        &format!(
            "/projects/{}/merge_requests/{number}/merge",
            encode_gitlab_project_path(&provider.full_name)
        ),
        Vec::new(),
    )
}

fn encode_gitlab_project_path(project_path: &str) -> String {
    project_path.trim().trim_matches('/').replace('/', "%2F")
}
