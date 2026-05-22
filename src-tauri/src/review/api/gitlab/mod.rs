mod client;
mod pull_requests;
mod repositories;

pub(crate) use pull_requests::{
    approve_merge_request, get_merge_request, get_merge_request_approvals,
    list_merge_request_changes, list_merge_request_commits, list_merge_requests,
    merge_merge_request, unapprove_merge_request, update_merge_request_state,
};
pub(crate) use repositories::{get_authenticated_user, get_project, list_project_members};
