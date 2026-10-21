//! Display names of models: the `ModelNaming` contract a provider supplies
//! with its catalog and `CatalogNames` (the one table type every provider
//! uses: model id → the catalog's name). A client shows these names as they
//! are; no name lives here, providers supply them.

use std::{collections::HashMap, sync::RwLock};

use crate::usage::normalize_model;

/// A provider's names of the models it runs.
pub trait ModelNaming: Send + Sync {
    /// The name of `model` (`Opus 5.5`), or `None` for a model the provider
    /// does not name.
    fn label(&self, model: &str) -> Option<String>;
}

/// A table of model ids → display names. A provider publishes it with its
/// model catalog and lists every id a thread setting, a model request or a
/// turn may name: its catalog rows and the models its aliases resolve to.
#[derive(Default)]
pub struct CatalogNames {
    names: RwLock<HashMap<String, String>>,
}

impl CatalogNames {
    /// A table of `names`; model ids are normalized ([`normalize_model`]).
    #[must_use]
    pub fn new(names: impl IntoIterator<Item = (String, String)>) -> Self {
        let table = Self::default();
        table.replace(names);
        table
    }

    /// Replaces the whole table, as the provider's latest catalog states it.
    pub fn replace(&self, names: impl IntoIterator<Item = (String, String)>) {
        let names = names
            .into_iter()
            .map(|(model, name)| (normalize_model(&model), name))
            .collect();
        // A poisoned lock still holds the previous complete table.
        match self.names.write() {
            Ok(mut current) => *current = names,
            Err(poisoned) => *poisoned.into_inner() = names,
        }
    }
}

impl ModelNaming for CatalogNames {
    fn label(&self, model: &str) -> Option<String> {
        let names = match self.names.read() {
            Ok(names) => names,
            Err(poisoned) => poisoned.into_inner(),
        };
        names.get(&normalize_model(model)).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_model_is_named_case_insensitively_and_an_unknown_one_is_unnamed() {
        let table = CatalogNames::new([("claude-opus-5-5".to_owned(), "Opus 5.5".to_owned())]);
        assert_eq!(
            table.label(" Claude-Opus-5-5 ").as_deref(),
            Some("Opus 5.5")
        );
        assert_eq!(table.label("claude-unknown-1"), None);
    }

    #[test]
    fn a_new_catalog_replaces_the_whole_table() {
        let table = CatalogNames::new([("opus".to_owned(), "Opus 5.5".to_owned())]);
        table.replace([("opus".to_owned(), "Opus 5.6".to_owned())]);
        assert_eq!(table.label("opus").as_deref(), Some("Opus 5.6"));
        table.replace(Vec::new());
        assert_eq!(table.label("opus"), None);
    }
}
