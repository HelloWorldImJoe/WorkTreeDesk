use serde_json::Value;

use crate::models::GiteeRepositoryInfo;

use super::client::GiteeApiClient;

pub(crate) fn list_repository_subscribers(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).get(
        &format!("/repos/{}/{}/subscribers", repo.owner, repo.repo),
        vec![("per_page".to_string(), "100".to_string())],
    )
}
