use serde_json::{json, Value};

use crate::models::ReviewProviderInfo;

use super::client::GithubApiClient;

pub(crate) fn list_pull_requests(
    provider: &ReviewProviderInfo,
    access_token: &str,
    state: &str,
    page: u32,
    per_page: u32,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!("/repos/{}/{}/pulls", provider.owner, provider.repo),
        vec![
            ("state".to_string(), state.to_string()),
            ("sort".to_string(), "updated".to_string()),
            ("direction".to_string(), "desc".to_string()),
            ("page".to_string(), page.to_string()),
            ("per_page".to_string(), per_page.to_string()),
        ],
    )
}

pub(crate) fn get_pull_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!("/repos/{}/{}/pulls/{number}", provider.owner, provider.repo),
        Vec::new(),
    )
}

pub(crate) fn list_pull_request_reviews(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!(
            "/repos/{}/{}/pulls/{number}/reviews",
            provider.owner, provider.repo
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn list_pull_request_commits(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!(
            "/repos/{}/{}/pulls/{number}/commits",
            provider.owner, provider.repo
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn list_pull_request_files(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!(
            "/repos/{}/{}/pulls/{number}/files",
            provider.owner, provider.repo
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn get_pull_request_commit_status(
    provider: &ReviewProviderInfo,
    access_token: &str,
    sha: &str,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!("/repos/{}/{}/commits/{sha}/status", provider.owner, provider.repo),
        Vec::new(),
    )
}

pub(crate) fn approve_pull_request_review(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).post_json(
        &format!("/repos/{}/{}/pulls/{number}/reviews", provider.owner, provider.repo),
        json!({
            "event": "APPROVE"
        }),
    )
}

pub(crate) fn update_pull_request_state(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
    state: &str,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).patch_json(
        &format!("/repos/{}/{}/pulls/{number}", provider.owner, provider.repo),
        json!({
            "state": state,
        }),
    )
}

pub(crate) fn merge_pull_request(
    provider: &ReviewProviderInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).put_json(
        &format!("/repos/{}/{}/pulls/{number}/merge", provider.owner, provider.repo),
        json!({}),
    )
}
