//! GitHub HTTP 客户端：构造鉴权请求并解析响应。
use serde_json::Value;

use crate::review::shared::{api_client, parse_json_response_with_label};

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";

pub(crate) struct GithubApiClient<'a> {
    access_token: &'a str,
}

impl<'a> GithubApiClient<'a> {
    pub(crate) fn new(access_token: &'a str) -> Self {
        Self { access_token }
    }

    pub(crate) fn get(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, String> {
        let response = api_client("GitHub")?
            .get(format!("{GITHUB_API_BASE}{path}"))
            .bearer_auth(self.access_token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .query(&query)
            .send()
            .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

        parse_json_response_with_label("GitHub", response)
    }

    pub(crate) fn post_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = api_client("GitHub")?
            .post(format!("{GITHUB_API_BASE}{path}"))
            .bearer_auth(self.access_token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .json(&body)
            .send()
            .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

        parse_json_response_with_label("GitHub", response)
    }

    pub(crate) fn patch_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = api_client("GitHub")?
            .patch(format!("{GITHUB_API_BASE}{path}"))
            .bearer_auth(self.access_token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .json(&body)
            .send()
            .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

        parse_json_response_with_label("GitHub", response)
    }

    pub(crate) fn put_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = api_client("GitHub")?
            .put(format!("{GITHUB_API_BASE}{path}"))
            .bearer_auth(self.access_token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .json(&body)
            .send()
            .map_err(|error| format!("Failed to reach GitHub API: {error}"))?;

        parse_json_response_with_label("GitHub", response)
    }
}
