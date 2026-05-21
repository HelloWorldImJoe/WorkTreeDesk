use serde_json::Value;

use crate::models::ReviewProviderInfo;

use super::client::GithubApiClient;

pub(crate) fn get_authenticated_user(access_token: &str) -> Result<Value, String> {
    GithubApiClient::new(access_token).get("/user", Vec::new())
}

pub(crate) fn list_repository_collaborators(
    provider: &ReviewProviderInfo,
    access_token: &str,
) -> Result<Value, String> {
    GithubApiClient::new(access_token).get(
        &format!(
            "/repos/{}/{}/collaborators",
            provider.owner, provider.repo
        ),
        vec![
            ("affiliation".to_string(), "all".to_string()),
            ("per_page".to_string(), "100".to_string()),
        ],
    )
}
