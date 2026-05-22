use std::path::Path;

use crate::{
    git::list_git_remotes,
    models::{
        GiteeRepositoryInfo, ReviewProviderCapabilities, ReviewProviderInfo, ReviewProviderKind,
    },
};

pub(crate) fn require_review_provider(repo_path: &Path) -> Result<ReviewProviderInfo, String> {
    detect_review_provider(repo_path).ok_or_else(|| {
        format!(
            "This repository does not expose a supported origin remote yet. Supported providers: Gitee, GitHub, GitLab. Repository: {}",
            repo_path.display()
        )
    })
}

pub(crate) fn require_gitee_repository(repo_path: &Path) -> Result<GiteeRepositoryInfo, String> {
    detect_gitee_repository(repo_path).ok_or_else(|| {
        format!(
            "This repository does not have a Gitee remote. Add a gitee.com remote first: {}",
            repo_path.display()
        )
    })
}

pub(crate) fn detect_review_provider(repo_path: &Path) -> Option<ReviewProviderInfo> {
    let remote = list_git_remotes(repo_path)
        .ok()?
        .into_iter()
        .find(|entry| entry.name == "origin")?;
    let url = remote.fetch_url.clone().or(remote.push_url.clone())?;
    let parsed = parse_review_provider_remote(&url)?;

    Some(ReviewProviderInfo {
        kind: parsed.kind,
        display_name: provider_display_name(parsed.kind).to_string(),
        remote_name: remote.name,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
        full_name: parsed.full_name,
        web_url: parsed.web_url,
        clone_url: parsed.clone_url,
        capabilities: provider_capabilities(parsed.kind),
    })
}

pub(crate) fn detect_gitee_repository(repo_path: &Path) -> Option<GiteeRepositoryInfo> {
    detect_review_provider(repo_path).filter(|provider| provider.kind == ReviewProviderKind::Gitee)
}

pub(crate) fn find_remote_name_for_repo(repo_path: &Path, owner: &str, repo: &str) -> Option<String> {
    list_git_remotes(repo_path)
        .ok()?
        .into_iter()
        .find_map(|remote| {
            let url = remote.fetch_url.as_deref().or(remote.push_url.as_deref())?;
            let parsed = parse_review_provider_remote(url)?;
            if parsed.owner == owner && parsed.repo == repo {
                Some(remote.name)
            } else {
                None
            }
        })
}

pub(crate) fn parse_review_provider_remote(url: &str) -> Option<ParsedReviewProviderRemote> {
    let (host, raw_path) = parse_git_remote_host_and_path(url)?;
    let cleaned = raw_path.trim().trim_matches('/').trim_end_matches(".git");
    let segments = cleaned
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }

    let repo = segments.last()?.to_string();
    let owner = segments[..segments.len() - 1].join("/");
    let full_name = format!("{owner}/{repo}");
    let kind = match host.as_str() {
        "gitee.com" => ReviewProviderKind::Gitee,
        "github.com" => ReviewProviderKind::Github,
        _ if host == "gitlab.com" || host.contains("gitlab") => ReviewProviderKind::Gitlab,
        _ => return None,
    };

    Some(ParsedReviewProviderRemote {
        kind,
        host: host.clone(),
        owner,
        repo,
        full_name: full_name.clone(),
        web_url: format!("https://{host}/{full_name}"),
        clone_url: format!("https://{host}/{full_name}.git"),
    })
}

#[cfg(test)]
pub(crate) fn gitee_https_path(url: &str) -> Option<&str> {
    let trimmed = url.trim().trim_end_matches('/');
    let remainder = if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else {
        return None;
    };

    let without_userinfo = remainder.rsplit_once('@').map(|(_, rest)| rest).unwrap_or(remainder);
    without_userinfo.strip_prefix("gitee.com/")
}

pub(crate) fn is_provider_https_url(url: &str, provider: &ReviewProviderInfo) -> bool {
    parse_git_remote_host_and_path(url)
        .map(|(host, _)| host == provider.host)
        .unwrap_or(false)
}

pub(crate) struct ParsedReviewProviderRemote {
    pub(crate) kind: ReviewProviderKind,
    pub(crate) host: String,
    pub(crate) owner: String,
    pub(crate) repo: String,
    pub(crate) full_name: String,
    pub(crate) web_url: String,
    pub(crate) clone_url: String,
}

fn provider_display_name(kind: ReviewProviderKind) -> &'static str {
    match kind {
        ReviewProviderKind::Gitee => "Gitee",
        ReviewProviderKind::Github => "GitHub",
        ReviewProviderKind::Gitlab => "GitLab",
    }
}

fn provider_capabilities(kind: ReviewProviderKind) -> ReviewProviderCapabilities {
    match kind {
        ReviewProviderKind::Gitee => ReviewProviderCapabilities {
            approve_review: true,
            reset_review: true,
            approve_test: true,
            reset_test: true,
            show_test_status: true,
            reopen_pull_request: true,
            close_pull_request: true,
            merge_pull_request: true,
            code_review: true,
            cleanup_worktree: true,
        },
        ReviewProviderKind::Github => ReviewProviderCapabilities {
            approve_review: true,
            reset_review: false,
            approve_test: false,
            reset_test: false,
            show_test_status: false,
            reopen_pull_request: true,
            close_pull_request: true,
            merge_pull_request: true,
            code_review: true,
            cleanup_worktree: true,
        },
        ReviewProviderKind::Gitlab => ReviewProviderCapabilities {
            approve_review: true,
            reset_review: true,
            approve_test: false,
            reset_test: false,
            show_test_status: true,
            reopen_pull_request: true,
            close_pull_request: true,
            merge_pull_request: true,
            code_review: true,
            cleanup_worktree: true,
        },
    }
}

fn parse_git_remote_host_and_path(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches('/');

    if let Some(rest) = trimmed.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some((host.to_string(), path.to_string()));
    }

    if let Some(rest) = trimmed.strip_prefix("ssh://") {
        let rest = rest.rsplit_once('@').map(|(_, suffix)| suffix).unwrap_or(rest);
        let (host, path) = rest.split_once('/')?;
        return Some((host.to_string(), path.to_string()));
    }

    let rest = if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else {
        return None;
    };

    let rest = rest.rsplit_once('@').map(|(_, suffix)| suffix).unwrap_or(rest);
    let (host, path) = rest.split_once('/')?;
    Some((host.to_string(), path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{gitee_https_path, parse_review_provider_remote};
    use crate::models::ReviewProviderKind;

    #[test]
    fn parse_review_provider_remote_supports_https_userinfo() {
        let parsed = parse_review_provider_remote("https://user:token@gitee.com/team/repo.git")
            .expect("expected provider parsing to succeed");

        assert_eq!(parsed.kind, ReviewProviderKind::Gitee);
        assert_eq!(parsed.owner, "team");
        assert_eq!(parsed.repo, "repo");
    }

    #[test]
    fn gitee_https_path_strips_optional_userinfo() {
        assert_eq!(
            gitee_https_path("https://user@gitee.com/team/repo.git"),
            Some("team/repo.git")
        );
    }
}
