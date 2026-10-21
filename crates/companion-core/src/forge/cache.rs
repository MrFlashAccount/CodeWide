//! In-memory forge data: list pages and overviews with a freshness window,
//! and which account last listed each pull request. Forge content is never
//! written to disk by the companion.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use forge_protocol::PullRequestCategory;

use super::{
    ids::{ForgeAccountKey, PullRequestKey},
    limits,
    wire::{ListPageWire, OverviewWire},
};

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ListKey {
    pub category: PullRequestCategory,
    pub repository: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Default)]
struct Entries {
    lists: HashMap<ListKey, (Instant, ListPageWire)>,
    overviews: HashMap<PullRequestKey, (Instant, OverviewWire)>,
    listed_by: HashMap<PullRequestKey, ForgeAccountKey>,
}

#[derive(Clone, Default)]
pub struct ForgeCache {
    entries: Arc<Mutex<Entries>>,
}

impl ForgeCache {
    #[must_use]
    pub fn list(&self, key: &ListKey) -> Option<ListPageWire> {
        let entries = self.entries.lock().ok()?;
        let (at, page) = entries.lists.get(key)?;
        (at.elapsed() < limits::READ_FRESHNESS).then(|| page.clone())
    }

    pub fn put_list(&self, key: ListKey, page: &ListPageWire) {
        if let Ok(mut entries) = self.entries.lock() {
            for section in &page.sections {
                for row in &section.rows {
                    entries
                        .listed_by
                        .insert(row.pull_request.clone(), row.account.clone());
                }
            }
            entries.lists.insert(key, (Instant::now(), page.clone()));
        }
    }

    #[must_use]
    pub fn overview(&self, key: &PullRequestKey) -> Option<OverviewWire> {
        let entries = self.entries.lock().ok()?;
        let (at, overview) = entries.overviews.get(key)?;
        (at.elapsed() < limits::READ_FRESHNESS).then(|| overview.clone())
    }

    /// The last overview regardless of age (thread badges, local checkout).
    #[must_use]
    pub fn last_overview(&self, key: &PullRequestKey) -> Option<OverviewWire> {
        let entries = self.entries.lock().ok()?;
        entries
            .overviews
            .get(key)
            .map(|(_, overview)| overview.clone())
    }

    pub fn put_overview(&self, overview: &OverviewWire) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.listed_by.insert(
                overview.pull_request.clone(),
                overview.account.account.clone(),
            );
            entries.overviews.insert(
                overview.pull_request.clone(),
                (Instant::now(), overview.clone()),
            );
        }
    }

    #[must_use]
    pub fn listed_by(&self, key: &PullRequestKey) -> Option<ForgeAccountKey> {
        self.entries.lock().ok()?.listed_by.get(key).cloned()
    }

    /// Drops the overview of one pull request and every list page, so the
    /// next read refetches after a write.
    pub fn invalidate_pull_request(&self, key: &PullRequestKey) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.overviews.remove(key);
            entries.lists.clear();
        }
    }

    pub fn invalidate_all(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.overviews.clear();
            entries.lists.clear();
        }
    }
}
