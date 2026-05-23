//! GitLab HTTP 客户端：构造鉴权请求并解析响应。
use serde_json::Value;

use crate::review::shared::{api_client, parse_json_response_with_label};

pub(crate) struct GitlabApiClient<'a> {
    host: &'a str,
    access_token: &'a str,
}

impl<'a> GitlabApiClient<'a> {
    pub(crate) fn new(host: &'a str, access_token: &'a str) -> Self {
        Self { host, access_token }
    }

    pub(crate) fn get(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, String> {
        let response = api_client("GitLab")?
            .get(format!("https://{}/api/v4{}", self.host, path))
            .header("PRIVATE-TOKEN", self.access_token)
            .query(&query)
            .send()
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        parse_json_response_with_label("GitLab", response)
    }

    pub(crate) fn post(&self, path: &str) -> Result<Value, String> {
        let response = api_client("GitLab")?
            .post(format!("https://{}/api/v4{}", self.host, path))
            .header("PRIVATE-TOKEN", self.access_token)
            .send()
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        parse_json_response_with_label("GitLab", response)
    }

    pub(crate) fn post_form(
        &self,
        path: &str,
        form: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let response = api_client("GitLab")?
            .post(format!("https://{}/api/v4{}", self.host, path))
            .header("PRIVATE-TOKEN", self.access_token)
            .form(&form)
            .send()
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        parse_json_response_with_label("GitLab", response)
    }

    pub(crate) fn put(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, String> {
        let response = api_client("GitLab")?
            .put(format!("https://{}/api/v4{}", self.host, path))
            .header("PRIVATE-TOKEN", self.access_token)
            .query(&query)
            .send()
            .map_err(|error| format!("Failed to reach GitLab API: {error}"))?;

        parse_json_response_with_label("GitLab", response)
    }
}
