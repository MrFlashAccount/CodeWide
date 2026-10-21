//! The pull request implementation of the review context's
//! `DiffCatalogSource`: the forge diff at the current head, assembled from
//! file pages (never more than one page or patch above the companion caps
//! at a time).

use std::sync::{Arc, Weak};

use async_trait::async_trait;

use super::{
    ForgeContext,
    ids::PullRequestKey,
    reads::{files_page, load_overview},
    wire::PatchWire,
};
use crate::review::{
    ReviewError,
    hunks::parse_patch,
    source::{CatalogFile, DiffCatalog, DiffCatalogSource, DiffSource},
};

/// At most this many file pages make one catalog (GitHub lists at most
/// 3 000 files, 100 per page).
const MAX_PAGES: usize = 30;

pub struct PullRequestCatalog {
    context: Weak<ForgeContext>,
}

impl PullRequestCatalog {
    #[must_use]
    pub fn new(context: &Arc<ForgeContext>) -> Self {
        Self {
            context: Arc::downgrade(context),
        }
    }

    fn context(&self) -> Result<Arc<ForgeContext>, ReviewError> {
        self.context
            .upgrade()
            .ok_or_else(|| ReviewError::Unavailable("the forge service stopped".into()))
    }
}

fn key_of(
    source: &DiffSource,
) -> Result<(PullRequestKey, super::ids::PullRequestIdentity), ReviewError> {
    let DiffSource::PullRequest { pull_request } = source else {
        return Err(ReviewError::Invalid("not a pull request source".into()));
    };
    PullRequestKey::parse(pull_request)
        .ok_or_else(|| ReviewError::Invalid("unknown pullRequest key".into()))
}

#[async_trait]
impl DiffCatalogSource for PullRequestCatalog {
    async fn catalog(&self, source: &DiffSource) -> Result<DiffCatalog, ReviewError> {
        let context = self.context()?;
        let (key, identity) = key_of(source)?;
        let overview = match context.cache.overview(&key) {
            Some(overview) => overview,
            None => load_overview(&context, &key, &identity).await?,
        };
        let head = overview.head_revision.clone();
        let mut files = Vec::new();
        let mut cursor = None;
        for _ in 0..MAX_PAGES {
            let page = files_page(&context, &key, &identity, &head, cursor).await?;
            for file in page.files {
                if let PatchWire::Present { text, .. } = &file.patch {
                    let hunks = parse_patch(&file.path, text);
                    if !hunks.is_empty() {
                        files.push(CatalogFile {
                            path: file.path.clone(),
                            hunks,
                        });
                    }
                }
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(DiffCatalog {
            revision: head.as_str().to_owned(),
            files,
        })
    }

    async fn describe(&self, source: &DiffSource) -> String {
        match key_of(source) {
            Ok((key, identity)) => {
                let head = self
                    .context()
                    .ok()
                    .and_then(|context| context.cache.last_overview(&key))
                    .map(|overview| format!(" at {}", overview.head_revision.as_str()))
                    .unwrap_or_default();
                format!(
                    "pull request {}#{} on {}{head}",
                    identity.pr_ref.repository, identity.pr_ref.number, identity.pr_ref.host
                )
            }
            Err(_) => "a pull request".to_owned(),
        }
    }
}

impl From<super::errors::ForgeError> for ReviewError {
    fn from(error: super::errors::ForgeError) -> Self {
        let message = error.to_rpc_error()["message"]
            .as_str()
            .unwrap_or("The forge is unavailable")
            .to_owned();
        match error {
            super::errors::ForgeError::InvalidParams(message) => Self::Invalid(message),
            super::errors::ForgeError::NotFound => Self::NotFound,
            _ => Self::Source(message),
        }
    }
}
