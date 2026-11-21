//! Repository and pull request addressing shared by every forge method.

use forge_protocol::{ForgePrRef, PluginError, code};
use serde_json::Value;

use crate::api::Api;

/// `owner/name`, validated so it can be placed in a REST path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Repo {
    pub owner: String,
    pub name: String,
}

impl Repo {
    /// # Errors
    ///
    /// Returns invalid params unless `full` is `owner/name` of safe segments.
    pub fn parse(full: &str) -> Result<Self, PluginError> {
        let (owner, name) = full
            .split_once('/')
            .ok_or_else(|| PluginError::invalid_params("repository must be owner/name"))?;
        if !safe_segment(owner) || !safe_segment(name) {
            return Err(PluginError::invalid_params("invalid repository"));
        }
        Ok(Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    #[must_use]
    pub fn full(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }

    #[must_use]
    pub fn path(&self, rest: &str) -> String {
        format!("/repos/{}/{}{rest}", self.owner, self.name)
    }
}

fn safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 100
        && segment != "."
        && segment != ".."
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// A pull request reference resolved to its repository and number.
pub struct PullTarget {
    pub repo: Repo,
    pub number: u64,
}

impl PullTarget {
    /// # Errors
    ///
    /// Returns invalid params for a malformed repository or number.
    pub fn from_ref(pr_ref: &ForgePrRef) -> Result<Self, PluginError> {
        let number = pr_ref
            .number
            .parse::<u64>()
            .ok()
            .filter(|number| *number > 0)
            .ok_or_else(|| PluginError::invalid_params("invalid pull request number"))?;
        Ok(Self {
            repo: Repo::parse(&pr_ref.repository)?,
            number,
        })
    }

    #[must_use]
    pub fn path(&self, rest: &str) -> String {
        self.repo.path(&format!("/pulls/{}{rest}", self.number))
    }

    /// `GET /repos/{o}/{r}/pulls/{n}`.
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure.
    pub async fn fetch(&self, api: &Api) -> Result<Value, PluginError> {
        api.get(&self.path(""), &[]).await
    }

    /// Fetches the pull request and fails with `staleHead` unless its head
    /// is `expected`.
    ///
    /// # Errors
    ///
    /// Returns `staleHead` with the current head, or the mapped failure.
    pub async fn fetch_at_head(&self, api: &Api, expected: &str) -> Result<Value, PluginError> {
        let pull = self.fetch(api).await?;
        let head = head_sha(&pull)?;
        if head != expected {
            return Err(PluginError::stale_head(&head));
        }
        Ok(pull)
    }
}

/// The head commit of a REST pull request.
///
/// # Errors
///
/// Returns an internal error when GitHub omitted it.
pub fn head_sha(pull: &Value) -> Result<String, PluginError> {
    pull.pointer("/head/sha")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PluginError::internal("GitHub returned no head commit"))
}

/// The GraphQL node id of a REST pull request.
///
/// # Errors
///
/// Returns an internal error when GitHub omitted it.
pub fn node_id(pull: &Value) -> Result<String, PluginError> {
    pull.get("node_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PluginError::internal("GitHub returned no node id"))
}

/// `https://github.com/o/r(.git)`, `git@github.com:o/r.git` or
/// `ssh://git@github.com/o/r.git`, and pull request URLs under a
/// repository, resolved to `(host, owner/name)`.
#[must_use]
pub fn parse_remote(remote: &str) -> Option<(String, String)> {
    let remote = remote.trim();
    let (host, path) = if let Some(rest) = remote.strip_prefix("https://") {
        rest.split_once('/')?
    } else if let Some(rest) = remote.strip_prefix("ssh://") {
        let rest = rest.split_once('@').map_or(rest, |(_, rest)| rest);
        rest.split_once('/')?
    } else {
        remote.strip_prefix("git@")?.split_once(':')?
    };
    // Credentials inside an https remote are never returned or used.
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?;
    let name = segments.next()?;
    let name = name.strip_suffix(".git").unwrap_or(name);
    let repo = Repo::parse(&format!("{owner}/{name}")).ok()?;
    Some((host.to_ascii_lowercase(), repo.full()))
}

/// Maps the "head modified" family of GitHub refusals to `staleHead` after
/// reading the current head: `staleHead` when the head moved, an auth
/// failure of that read, else `fallback`.
pub async fn stale_or(
    api: &Api,
    target: &PullTarget,
    expected: &str,
    fallback: PluginError,
) -> PluginError {
    match target.fetch(api).await.and_then(|pull| head_sha(&pull)) {
        Ok(head) if head != expected => PluginError::stale_head(&head),
        Err(error) if error.code == code::AUTH_REQUIRED => error,
        Ok(_) | Err(_) => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_remote_forms_and_strips_credentials() {
        for remote in [
            "https://github.com/octo/repo.git",
            "https://github.com/octo/repo",
            "https://user:secret@github.com/octo/repo.git",
            "git@github.com:octo/repo.git",
            "ssh://git@github.com/octo/repo.git",
            "https://github.com/octo/repo/pull/12",
        ] {
            assert_eq!(
                parse_remote(remote),
                Some(("github.com".into(), "octo/repo".into())),
                "{remote}"
            );
        }
        assert_eq!(parse_remote("file:///tmp/repo"), None);
        assert_eq!(parse_remote("https://github.com/octo"), None);
        assert_eq!(parse_remote("https://github.com/../x"), None);
    }
}
