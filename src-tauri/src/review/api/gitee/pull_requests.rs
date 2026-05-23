//! Gitee PR API：读取、评论、审批、关闭和合并 PR。
use serde_json::Value;

use crate::models::GiteeRepositoryInfo;

use super::client::GiteeApiClient;

pub(crate) fn list_pull_requests(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    state: &str,
    page: u32,
    per_page: u32,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).get(
        &format!("/repos/{}/{}/pulls", repo.owner, repo.repo),
        vec![
            ("state".to_string(), state.to_string()),
            ("sort".to_string(), "created".to_string()),
            ("direction".to_string(), "desc".to_string()),
            ("page".to_string(), page.to_string()),
            ("per_page".to_string(), per_page.to_string()),
        ],
    )
}

pub(crate) fn get_pull_request(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).get(
        &format!("/repos/{}/{}/pulls/{}", repo.owner, repo.repo, number),
        Vec::new(),
    )
}

pub(crate) fn list_pull_request_commits(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).get(
        &format!(
            "/repos/{}/{}/pulls/{}/commits",
            repo.owner, repo.repo, number
        ),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn list_pull_request_files(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).get(
        &format!("/repos/{}/{}/pulls/{}/files", repo.owner, repo.repo, number),
        vec![("per_page".to_string(), "100".to_string())],
    )
}

pub(crate) fn approve_pull_request_review(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).post_form(
        &format!(
            "/repos/{}/{}/pulls/{}/review",
            repo.owner, repo.repo, number
        ),
        vec![
            ("action".to_string(), "approve".to_string()),
            ("event".to_string(), "approve".to_string()),
            ("state".to_string(), "approved".to_string()),
        ],
    )
}

pub(crate) fn approve_pull_request_test(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).post_form(
        &format!("/repos/{}/{}/pulls/{}/test", repo.owner, repo.repo, number),
        vec![
            ("action".to_string(), "pass".to_string()),
            ("event".to_string(), "pass".to_string()),
            ("state".to_string(), "passed".to_string()),
        ],
    )
}

pub(crate) fn reset_pull_request_review(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).post_form(
        &format!(
            "/repos/{}/{}/pulls/{}/review/reset",
            repo.owner, repo.repo, number
        ),
        Vec::new(),
    )
}

pub(crate) fn reset_pull_request_test(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).post_form(
        &format!(
            "/repos/{}/{}/pulls/{}/test/reset",
            repo.owner, repo.repo, number
        ),
        Vec::new(),
    )
}

pub(crate) fn create_pull_request_comment(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
    body: &str,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).post_form(
        &format!(
            "/repos/{}/{}/pulls/{number}/comments",
            repo.owner, repo.repo
        ),
        vec![("body".to_string(), body.to_string())],
    )
}

pub(crate) fn update_pull_request_state(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
    state: &str,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).patch_form(
        &format!("/repos/{}/{}/pulls/{number}", repo.owner, repo.repo),
        vec![("state".to_string(), state.to_string())],
    )
}

pub(crate) fn merge_pull_request(
    repo: &GiteeRepositoryInfo,
    access_token: &str,
    number: i64,
) -> Result<Value, String> {
    GiteeApiClient::new(access_token).put_form(
        &format!("/repos/{}/{}/pulls/{number}/merge", repo.owner, repo.repo),
        Vec::new(),
    )
}
