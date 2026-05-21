use std::{collections::BTreeMap, path::Path, process::Command};

use crate::models::GitRemoteInfo;

pub(crate) fn paths_equal(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub(crate) fn run_git(repo_path: &Path, args: &[String]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub(crate) fn git_stdout(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    run_git(repo_path, &args)
}

pub(crate) fn list_git_remotes(repo_path: &Path) -> Result<Vec<GitRemoteInfo>, String> {
    let output = git_stdout(repo_path, &["remote", "-v"])?;
    let mut remotes: BTreeMap<String, GitRemoteInfo> = BTreeMap::new();

    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or_default().trim();
        let url = parts.next().unwrap_or_default().trim();
        let kind = parts
            .next()
            .unwrap_or_default()
            .trim()
            .trim_start_matches('(')
            .trim_end_matches(')');

        if name.is_empty() || url.is_empty() {
            continue;
        }

        let entry = remotes.entry(name.to_string()).or_insert(GitRemoteInfo {
            name: name.to_string(),
            fetch_url: None,
            push_url: None,
        });

        match kind {
            "fetch" => entry.fetch_url = Some(url.to_string()),
            "push" => entry.push_url = Some(url.to_string()),
            _ => {}
        }
    }

    Ok(remotes.into_values().collect())
}
