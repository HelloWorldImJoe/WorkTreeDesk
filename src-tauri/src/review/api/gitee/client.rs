//! Gitee HTTP 客户端：构造鉴权请求并解析响应。
use serde_json::Value;

use crate::review::shared::{api_client, parse_json_response};

const GITEE_API_BASE: &str = "https://gitee.com/api/v5";

pub(crate) struct GiteeApiClient<'a> {
    access_token: &'a str,
}

impl<'a> GiteeApiClient<'a> {
    pub(crate) fn new(access_token: &'a str) -> Self {
        Self { access_token }
    }

    pub(crate) fn get(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, String> {
        let mut full_query = vec![("access_token".to_string(), self.access_token.to_string())];
        full_query.extend(query);

        let response = api_client("Gitee")?
            .get(format!("{GITEE_API_BASE}{path}"))
            .query(&full_query)
            .send()
            .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

        parse_json_response(response)
    }

    pub(crate) fn post_form(
        &self,
        path: &str,
        form: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let response = api_client("Gitee")?
            .post(format!("{GITEE_API_BASE}{path}"))
            .query(&[("access_token", self.access_token)])
            .form(&form)
            .send()
            .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

        parse_json_response(response)
    }

    pub(crate) fn patch_form(
        &self,
        path: &str,
        form: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let response = api_client("Gitee")?
            .patch(format!("{GITEE_API_BASE}{path}"))
            .query(&[("access_token", self.access_token)])
            .form(&form)
            .send()
            .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

        parse_json_response(response)
    }

    pub(crate) fn put_form(
        &self,
        path: &str,
        form: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let response = api_client("Gitee")?
            .put(format!("{GITEE_API_BASE}{path}"))
            .query(&[("access_token", self.access_token)])
            .form(&form)
            .send()
            .map_err(|error| format!("Failed to reach Gitee API: {error}"))?;

        parse_json_response(response)
    }
}
