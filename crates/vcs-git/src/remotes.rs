//! `vcs.remotes@1` for Git: `symbolic-ref` for the branch (none on a
//! detached head), `@{upstream}` for the tracking branch and `remote -v`
//! for the fetch URLs, with credentials removed from every URL.

use std::path::Path;

use tokio::process::Command;

use crate::{GitProvider, REMOTES_CAPABILITY, UpstreamRef, VcsError, VcsRemote, VcsRemotes};

impl GitProvider {
    /// The branch, upstream and remotes of a Git workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is not a Git repository or Git
    /// cannot run.
    pub async fn remotes(&self, workspace: &Path) -> Result<VcsRemotes, VcsError> {
        if self.detect(workspace).await?.is_none() {
            return Err(VcsError::UnsupportedWorkspace(workspace.to_path_buf()));
        }
        let branch = git(workspace, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .await?
            .filter(|branch| !branch.is_empty());
        let names = git(workspace, &["remote"]).await?.unwrap_or_default();
        let names: Vec<&str> = names
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .collect();
        let upstream = match &branch {
            Some(_) => git(
                workspace,
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}",
                ],
            )
            .await?
            .and_then(|tracking| {
                names.iter().find_map(|name| {
                    let branch = tracking.strip_prefix(&format!("{name}/"))?;
                    Some(UpstreamRef {
                        remote: (*name).to_owned(),
                        branch: branch.to_owned(),
                    })
                })
            }),
            None => None,
        };
        let mut remotes = Vec::new();
        for name in &names {
            if let Some(url) = git(workspace, &["remote", "get-url", name]).await? {
                remotes.push(VcsRemote {
                    name: (*name).to_owned(),
                    url: strip_credentials(&url),
                });
            }
        }
        Ok(VcsRemotes {
            capability: REMOTES_CAPABILITY.into(),
            provider: self.id().into(),
            branch,
            upstream,
            remotes,
        })
    }
}

/// Runs `git -C <workspace> <args>`; `None` for a non-zero exit.
async fn git(workspace: &Path, args: &[&str]) -> Result<Option<String>, VcsError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .args(args)
        .output()
        .await
        .map_err(|error| VcsError::Plugin(format!("could not start git: {error}")))?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_owned(),
    ))
}

/// Removes `user[:password]@` from URL-shaped remotes; scp-style
/// `git@host:path` remotes carry no secret and stay as they are.
fn strip_credentials(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_owned();
    };
    let (authority, path) = rest
        .split_once('/')
        .map_or((rest, ""), |(authority, path)| (authority, path));
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if path.is_empty() {
        format!("{scheme}://{host}")
    } else {
        format!("{scheme}://{host}/{path}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_never_leave_a_remote_url() {
        assert_eq!(
            strip_credentials("https://user:ghp_secret@github.com/o/r.git"),
            "https://github.com/o/r.git"
        );
        assert_eq!(
            strip_credentials("git@github.com:o/r.git"),
            "git@github.com:o/r.git"
        );
        assert_eq!(
            strip_credentials("ssh://git@github.com/o/r.git"),
            "ssh://github.com/o/r.git"
        );
    }
}
