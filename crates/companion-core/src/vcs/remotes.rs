//! `vcs.remotes@1`: the current branch, its upstream and the remote URLs of
//! a workspace, used by forge branch detection. Optional and additive: a
//! provider that does not declare it answers `None`, and nothing else in
//! VCS ownership changes.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{
    VcsError, VcsScope, VcsService,
    plugin::{PROTOCOL_VERSION, PluginSession, validate_initialize_metadata},
};

pub const REMOTES_CAPABILITY: &str = "vcs.remotes@1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRemote {
    pub name: String,
    /// Credentials are stripped by the provider.
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamRef {
    pub remote: String,
    pub branch: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRemotes {
    pub capability: String,
    pub provider: String,
    /// `None` on a detached head.
    pub branch: Option<String>,
    pub upstream: Option<UpstreamRef>,
    pub remotes: Vec<VcsRemote>,
}

impl VcsRemotes {
    /// Remote URLs in detection order: the upstream's remote, then
    /// `upstream`, then `origin`, then the rest.
    #[must_use]
    pub fn ordered_urls(&self) -> Vec<String> {
        let rank = |remote: &VcsRemote| {
            if self
                .upstream
                .as_ref()
                .is_some_and(|upstream| upstream.remote == remote.name)
            {
                0
            } else if remote.name == "upstream" {
                1
            } else if remote.name == "origin" {
                2
            } else {
                3
            }
        };
        let mut remotes: Vec<&VcsRemote> = self.remotes.iter().collect();
        remotes.sort_by_key(|remote| rank(remote));
        let mut urls = Vec::new();
        for remote in remotes {
            if !urls.contains(&remote.url) {
                urls.push(remote.url.clone());
            }
        }
        urls
    }
}

impl VcsService {
    /// The remotes of the provider that owns `workspace`, or `None` when it
    /// does not declare `vcs.remotes@1`.
    ///
    /// # Errors
    ///
    /// Returns an error when no provider owns the workspace or the owner
    /// fails.
    pub async fn remotes(&self, workspace: &Path) -> Result<Option<VcsRemotes>, VcsError> {
        let plugin = self.owning_plugin(workspace, VcsScope::Uncommitted).await?;
        let failed = |error: super::plugin::PluginCallError| {
            VcsError::Plugin(format!("{}: {error}", plugin.id))
        };
        let mut session = PluginSession::spawn(&plugin, workspace).map_err(failed)?;
        let initialized = session
            .request(
                1,
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "client": { "name": "codewide-companion" },
                    "capabilities": [REMOTES_CAPABILITY]
                }),
            )
            .await;
        let initialized = match initialized {
            Ok(initialized) => initialized,
            Err(error) => {
                session.shutdown().await;
                return Err(failed(error));
            }
        };
        if !validate_initialize_metadata(&plugin, &initialized, REMOTES_CAPABILITY)
            .map_err(failed)?
        {
            session.shutdown().await;
            return Ok(None);
        }
        let result = session
            .request(2, "vcs.remotes", json!({ "workspace": workspace }))
            .await;
        session.shutdown().await;
        let remotes =
            serde_json::from_value::<VcsRemotes>(result.map_err(failed)?).map_err(|error| {
                VcsError::Plugin(format!(
                    "{}: invalid vcs.remotes result: {error}",
                    plugin.id
                ))
            })?;
        if remotes.capability != REMOTES_CAPABILITY || remotes.provider != plugin.id {
            return Err(VcsError::Plugin(format!(
                "{}: vcs.remotes returned another provider or capability",
                plugin.id
            )));
        }
        Ok(Some(remotes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_upstream_remote_is_probed_first() {
        let remotes = VcsRemotes {
            capability: REMOTES_CAPABILITY.into(),
            provider: "git".into(),
            branch: Some("feature".into()),
            upstream: Some(UpstreamRef {
                remote: "fork".into(),
                branch: "feature".into(),
            }),
            remotes: vec![
                VcsRemote {
                    name: "origin".into(),
                    url: "https://github.com/me/repo.git".into(),
                },
                VcsRemote {
                    name: "fork".into(),
                    url: "https://github.com/other/repo.git".into(),
                },
            ],
        };
        assert_eq!(
            remotes.ordered_urls(),
            vec![
                "https://github.com/other/repo.git".to_owned(),
                "https://github.com/me/repo.git".to_owned()
            ]
        );
    }
}
