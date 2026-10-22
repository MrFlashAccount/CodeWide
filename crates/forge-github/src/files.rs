//! `forge.pullRequest.files`: file pages with patches and viewed states.

use std::collections::HashMap;

use forge_protocol::{
    FilePatch, FileStatus, FilesResult, PluginError, PullRequestFile, Truncation, code,
};
use serde_json::{Value, json};

use crate::{api::Api, repo::PullTarget};

/// GitHub lists at most this many files of one pull request.
pub const GITHUB_FILE_LIMIT: u32 = 3_000;
const FILES_PAGE_SIZE: u32 = 100;
const MAX_VIEWED_PAGES: usize = 30;

const VIEWED_QUERY: &str = r"
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path viewerViewedState }
      }
    }
  }
}";

/// `forge.pullRequest.files`: one page of at most 100 files at a head.
///
/// # Errors
///
/// Returns `staleHead` when the head moved, or the mapped GitHub failure.
pub async fn files(
    api: &Api,
    target: &PullTarget,
    head_revision: &str,
    cursor: Option<String>,
) -> Result<FilesResult, PluginError> {
    let pull = target.fetch_at_head(api, head_revision).await?;
    let page = cursor
        .as_deref()
        .map_or(Ok(1), str::parse::<u32>)
        .map_err(|_| PluginError::invalid_params("invalid files cursor"))?
        .max(1);
    let total = pull
        .get("changed_files")
        .and_then(Value::as_u64)
        .and_then(|total| u32::try_from(total).ok())
        .unwrap_or(0);
    let listed = api
        .get(
            &target.path("/files"),
            &[
                ("per_page", FILES_PAGE_SIZE.to_string()),
                ("page", page.to_string()),
            ],
        )
        .await?;
    let entries = listed.as_array().map(Vec::as_slice).unwrap_or_default();
    let viewed = if entries.is_empty() {
        HashMap::new()
    } else {
        viewed_states(api, target).await.unwrap_or_default()
    };
    let files = entries
        .iter()
        .filter_map(|entry| file(entry, &viewed))
        .collect::<Vec<_>>();
    let available = total.min(GITHUB_FILE_LIMIT);
    let shown_so_far = (page - 1)
        .saturating_mul(FILES_PAGE_SIZE)
        .saturating_add(u32::try_from(entries.len()).unwrap_or(u32::MAX));
    let next_cursor = (u32::try_from(entries.len()).unwrap_or(0) == FILES_PAGE_SIZE
        && shown_so_far < available)
        .then(|| (page + 1).to_string());
    Ok(FilesResult {
        head_revision: head_revision.to_owned(),
        files,
        truncated: (total > GITHUB_FILE_LIMIT).then_some(Truncation {
            shown: GITHUB_FILE_LIMIT,
            total,
        }),
        next_cursor,
    })
}

fn file(entry: &Value, viewed: &HashMap<String, bool>) -> Option<PullRequestFile> {
    let path = entry.get("filename")?.as_str()?.to_owned();
    let count = |field: &str| {
        entry
            .get(field)
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0)
    };
    let status = match entry.get("status")?.as_str()? {
        "added" => FileStatus::Added,
        "removed" => FileStatus::Removed,
        "renamed" => FileStatus::Renamed,
        "copied" => FileStatus::Copied,
        _ => FileStatus::Modified,
    };
    let additions = count("additions");
    let deletions = count("deletions");
    let file_patch = match entry.get("patch").and_then(Value::as_str) {
        Some(text) => FilePatch::Present {
            text: text.to_owned(),
        },
        None if additions == 0 && deletions == 0 && status == FileStatus::Renamed => {
            FilePatch::NotProvided
        }
        None if additions == 0 && deletions == 0 => FilePatch::Binary,
        None => FilePatch::TooLarge { bytes: None },
    };
    Some(PullRequestFile {
        viewed: Some(viewed.get(&path).copied().unwrap_or(false)),
        path,
        previous_path: entry
            .get("previous_filename")
            .and_then(Value::as_str)
            .map(str::to_owned),
        status,
        additions,
        deletions,
        patch: file_patch,
    })
}

async fn viewed_states(
    api: &Api,
    target: &PullTarget,
) -> Result<HashMap<String, bool>, PluginError> {
    let mut states = HashMap::new();
    let mut after: Option<String> = None;
    for _ in 0..MAX_VIEWED_PAGES {
        let data = api
            .graphql(
                VIEWED_QUERY,
                json!({
                    "owner": target.repo.owner, "name": target.repo.name,
                    "number": target.number, "after": after,
                }),
            )
            .await?;
        let files = data
            .pointer("/repository/pullRequest/files")
            .ok_or_else(|| PluginError::new(code::NOT_FOUND, "Not found on GitHub"))?;
        for node in files
            .get("nodes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(path) = node.get("path").and_then(Value::as_str) {
                states.insert(
                    path.to_owned(),
                    node.get("viewerViewedState").and_then(Value::as_str) == Some("VIEWED"),
                );
            }
        }
        if files.pointer("/pageInfo/hasNextPage") != Some(&Value::Bool(true)) {
            break;
        }
        after = files
            .pointer("/pageInfo/endCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    Ok(states)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_patches_become_binary_too_large_or_not_provided() {
        let viewed = HashMap::new();
        let binary =
            json!({"filename": "a.png", "status": "added", "additions": 0, "deletions": 0});
        let large =
            json!({"filename": "b.txt", "status": "modified", "additions": 9000, "deletions": 1});
        let renamed = json!({"filename": "c", "previous_filename": "d", "status": "renamed", "additions": 0, "deletions": 0});
        assert_eq!(
            file(&binary, &viewed).map(|file| file.patch),
            Some(FilePatch::Binary)
        );
        assert_eq!(
            file(&large, &viewed).map(|file| file.patch),
            Some(FilePatch::TooLarge { bytes: None })
        );
        assert_eq!(
            file(&renamed, &viewed).map(|file| file.patch),
            Some(FilePatch::NotProvided)
        );
    }
}
