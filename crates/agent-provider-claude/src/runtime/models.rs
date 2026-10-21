//! The Claude model catalog (`host/src/catalog/models.ts`).
//!
//! Rows come from the `models` of the runtime probe's `initialize` answer
//! (the Agent SDK's `supportedModels()`; the probe makes no model call).
//! The last non-empty list is kept; when a probe fails the catalog serves
//! that cache, or an empty list. Exactly one row is the default: the
//! `default` alias when present, otherwise the first row. Prices come with
//! the list ([`super::prices`]).

use std::collections::BTreeMap;

use agent_core::model::{InputModality, ModelCatalog, ModelEffort, ModelEntry, ModelPriceEntry};

use super::prices::catalog_prices;

/// The value of Claude's `default` alias row, whose target moves.
pub const DEFAULT_MODEL: &str = "default";

/// One row of Claude's model list as the `initialize` answer reports it
/// (`ModelInfo`), validated by [`super::probe::raw_models`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawModel {
    /// The id a session is started with (`--model`): an alias or a
    /// canonical API model id.
    pub value: String,
    /// Claude's name of the row (`Opus`, `Default (recommended)`).
    pub display_name: String,
    /// Empty when Claude reports none.
    pub description: String,
    /// The canonical API model id an alias row resolves to, when reported.
    pub resolved_model: Option<String>,
    /// `low` … `max`, in Claude's order; empty for a model without effort.
    pub supported_effort_levels: Vec<String>,
}

fn effort_description(effort: &str) -> &str {
    match effort {
        "high" => "Deeper reasoning",
        "low" => "Fastest responses",
        "max" => "Maximum reasoning",
        "medium" => "Balanced",
        "xhigh" => "Extended reasoning",
        other => other,
    }
}

/// The neutral catalog rows of Claude's model list.
#[must_use]
pub fn model_entries(models: &[RawModel]) -> Vec<ModelEntry> {
    let default_index = models
        .iter()
        .position(|model| model.value == DEFAULT_MODEL)
        .unwrap_or(0);
    models
        .iter()
        .enumerate()
        .map(|(index, model)| {
            let efforts = &model.supported_effort_levels;
            ModelEntry {
                id: model.value.clone(),
                model: model.value.clone(),
                display_name: versioned_display_name(model),
                description: model.description.clone(),
                is_default: index == default_index,
                hidden: false,
                efforts: efforts
                    .iter()
                    .map(|effort| ModelEffort {
                        effort: effort.clone(),
                        description: effort_description(effort).to_owned(),
                    })
                    .collect(),
                default_effort: if efforts.iter().any(|effort| effort == "high") {
                    Some("high".to_owned())
                } else {
                    efforts.first().cloned()
                },
                input_modalities: vec![InputModality::Text, InputModality::Image],
            }
        })
        .collect()
}

/// The row's name with its model version. Claude names alias rows by family
/// only (`Opus`) and leads their description with the versioned name
/// (`Opus 5.5 · …`); the `default` row names the model it currently
/// resolves to, either as `Use the default model (currently Opus 5.5)` or,
/// in older releases, as a leading versioned name. A description that does
/// not lead with the family keeps Claude's name.
fn versioned_display_name(model: &RawModel) -> String {
    let named = match model.description.find(" · ") {
        Some(separator) if separator > 0 => model.description[..separator].trim(),
        _ => "",
    };
    if model.value == DEFAULT_MODEL {
        return match current_default_name(&model.description) {
            Some(current) => format!("Default ({current})"),
            None if !named.is_empty() && !named.contains('(') => format!("Default ({named})"),
            None => model.display_name.clone(),
        };
    }
    if named.is_empty() {
        return model.display_name.clone();
    }
    if named
        .strip_prefix(model.display_name.as_str())
        .is_some_and(|rest| rest.starts_with(' '))
    {
        named.to_owned()
    } else {
        model.display_name.clone()
    }
}

/// The model named by the `default` row's `(currently Opus 5.5)` clause.
fn current_default_name(description: &str) -> Option<&str> {
    const MARKER: &str = "(currently ";
    let start = description.find(MARKER)? + MARKER.len();
    let length = description[start..].find(')')?;
    Some(description[start..start + length].trim()).filter(|name| !name.is_empty())
}

/// The catalog id of a model a session recorded: the row with that id, else
/// the alias row that resolves to it (not `default`, whose target moves),
/// else the recorded id itself.
#[must_use]
pub fn catalog_model_id<'a>(models: &'a [RawModel], recorded: &'a str) -> &'a str {
    if models.iter().any(|model| model.value == recorded) {
        return recorded;
    }
    models
        .iter()
        .find(|model| {
            model.value != DEFAULT_MODEL && model.resolved_model.as_deref() == Some(recorded)
        })
        .map_or(recorded, |alias| alias.value.as_str())
}

/// The catalog's names of every model a thread may name: each row's id, the
/// model an alias row resolves to (named like that alias, `Opus 5.5`), and
/// the model only `default` resolves to (named as its current model). A
/// model with its own row keeps that row's name.
#[must_use]
pub fn catalog_names(models: &[RawModel]) -> Vec<(String, String)> {
    let mut names: Vec<(String, String)> = models
        .iter()
        .map(|model| (model.value.clone(), versioned_display_name(model)))
        .collect();
    let mut name_target = |model: &str, name: String| {
        if !names.iter().any(|(named, _)| named == model) {
            names.push((model.to_owned(), name));
        }
    };
    for model in models.iter().filter(|model| model.value != DEFAULT_MODEL) {
        if let Some(resolved) = model.resolved_model.as_deref() {
            name_target(resolved, versioned_display_name(model));
        }
    }
    for model in models.iter().filter(|model| model.value == DEFAULT_MODEL) {
        if let (Some(resolved), Some(current)) =
            (model.resolved_model.as_deref(), default_target_name(model))
        {
            name_target(resolved, current.to_owned());
        }
    }
    names
}

/// The versioned name of the model the `default` row resolves to: its
/// `(currently Opus 5.5)` clause, else the name its description leads with.
fn default_target_name(model: &RawModel) -> Option<&str> {
    current_default_name(&model.description).or_else(|| {
        let separator = model.description.find(" · ")?;
        let named = model.description[..separator].trim();
        (!named.is_empty() && !named.contains('(')).then_some(named)
    })
}

/// Keeps the last non-empty model list, its catalog rows and the prices of
/// its models. Prices of the known canonical models are available before the
/// first list.
#[derive(Clone, Debug)]
pub struct ModelCatalogCache {
    raw: Vec<RawModel>,
    entries: Vec<ModelEntry>,
    prices: BTreeMap<String, ModelPriceEntry>,
    names: Vec<(String, String)>,
}

impl Default for ModelCatalogCache {
    fn default() -> Self {
        Self {
            raw: Vec::new(),
            entries: Vec::new(),
            prices: catalog_prices(&[]),
            names: Vec::new(),
        }
    }
}

impl ModelCatalogCache {
    /// Replaces the cache with a probe's list; an empty list keeps it.
    pub fn update(&mut self, models: Vec<RawModel>) {
        if models.is_empty() {
            return;
        }
        self.entries = model_entries(&models);
        self.prices = catalog_prices(&models);
        self.names = catalog_names(&models);
        self.raw = models;
    }

    /// [`catalog_model_id`] over the last list.
    #[must_use]
    pub fn id_for<'a>(&'a self, recorded: &'a str) -> &'a str {
        catalog_model_id(&self.raw, recorded)
    }

    /// [`catalog_names`] of the last list; empty before one.
    #[must_use]
    pub fn names(&self) -> &[(String, String)] {
        &self.names
    }

    /// The catalog rows of the last list; empty before one.
    #[must_use]
    pub fn models(&self) -> &[ModelEntry] {
        &self.entries
    }

    /// Prices by model id: every known canonical model, plus the rows of
    /// the last list that resolve to one.
    #[must_use]
    pub fn prices(&self) -> &BTreeMap<String, ModelPriceEntry> {
        &self.prices
    }

    /// The `catalog.models` answer: an owned snapshot of rows and prices.
    #[must_use]
    pub fn catalog(&self) -> ModelCatalog {
        ModelCatalog {
            models: self.entries.clone(),
            prices: self.prices.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(value: &str, display_name: &str, description: &str) -> RawModel {
        RawModel {
            value: value.to_owned(),
            display_name: display_name.to_owned(),
            description: description.to_owned(),
            resolved_model: None,
            supported_effort_levels: Vec::new(),
        }
    }

    fn alias(value: &str, display_name: &str, resolved: &str) -> RawModel {
        RawModel {
            resolved_model: Some(resolved.to_owned()),
            ..row(value, display_name, "")
        }
    }

    #[test]
    fn names_carry_the_version_each_description_leads_with() {
        let names: Vec<String> = model_entries(&[
            row(
                "default",
                "Default (recommended)",
                "Opus 5.5 · Best for everyday, complex tasks",
            ),
            row(
                "opus",
                "Opus",
                "Opus 5.5 · Best for everyday, complex tasks",
            ),
            row(
                "fable",
                "Fable",
                "Fable 5.1 · Most capable for your hardest tasks",
            ),
            row("custom", "Custom", "Something else · unrelated"),
            row("claude-sonnet-4-6", "Sonnet 4.6", ""),
        ])
        .into_iter()
        .map(|entry| entry.display_name)
        .collect();
        assert_eq!(
            names,
            [
                "Default (Opus 5.5)",
                "Opus 5.5",
                "Fable 5.1",
                "Custom",
                "Sonnet 4.6"
            ]
        );
    }

    #[test]
    fn the_default_row_names_the_model_it_currently_resolves_to() {
        let name = |description: &str| {
            model_entries(&[row("default", "Default (recommended)", description)])
                .remove(0)
                .display_name
        };
        assert_eq!(
            name("Use the default model (currently Opus 5.5) · $5/$25 per Mtok"),
            "Default (Opus 5.5)"
        );
        assert_eq!(
            name("Use the default model (currently Opus 5.5)"),
            "Default (Opus 5.5)"
        );
        assert_eq!(
            name("Something (else) · unrelated"),
            "Default (recommended)"
        );
        assert_eq!(name(""), "Default (recommended)");
    }

    #[test]
    fn the_default_alias_is_the_default_row_else_the_first() {
        let defaults = |models: &[RawModel]| -> Vec<bool> {
            model_entries(models)
                .into_iter()
                .map(|entry| entry.is_default)
                .collect()
        };
        assert_eq!(
            defaults(&[row("opus", "Opus", ""), row("default", "Default", "")]),
            [false, true]
        );
        assert_eq!(
            defaults(&[row("opus", "Opus", ""), row("sonnet", "Sonnet", "")]),
            [true, false]
        );
    }

    #[test]
    fn efforts_default_to_high_else_the_first_level() {
        let with_efforts = |levels: &[&str]| RawModel {
            supported_effort_levels: levels.iter().map(|level| (*level).to_owned()).collect(),
            ..row("opus", "Opus", "")
        };
        let entries = model_entries(&[
            with_efforts(&["low", "high", "custom"]),
            with_efforts(&["medium"]),
            with_efforts(&[]),
        ]);
        assert_eq!(entries[0].default_effort.as_deref(), Some("high"));
        assert_eq!(
            entries[0]
                .efforts
                .iter()
                .map(|effort| effort.description.as_str())
                .collect::<Vec<_>>(),
            ["Fastest responses", "Deeper reasoning", "custom"]
        );
        assert_eq!(entries[1].default_effort.as_deref(), Some("medium"));
        assert_eq!(entries[2].default_effort, None);
        assert_eq!(
            entries[0].input_modalities,
            [InputModality::Text, InputModality::Image]
        );
    }

    #[test]
    fn a_recorded_model_maps_to_its_alias_row_but_never_to_default() {
        let models = [
            alias("default", "Default", "claude-opus-5-5"),
            alias("opus", "Opus", "claude-opus-5-5"),
            row("claude-sonnet-4-6", "Sonnet", ""),
        ];
        assert_eq!(catalog_model_id(&models, "claude-opus-5-5"), "opus");
        assert_eq!(
            catalog_model_id(&models, "claude-sonnet-4-6"),
            "claude-sonnet-4-6"
        );
        assert_eq!(
            catalog_model_id(&models, "claude-unknown-1"),
            "claude-unknown-1"
        );
        assert_eq!(
            catalog_model_id(&[alias("default", "Default", "claude-x")], "claude-x"),
            "claude-x"
        );
    }

    #[test]
    fn every_model_a_thread_may_name_is_named_like_its_catalog_row() {
        let names = catalog_names(&[
            RawModel {
                description: "Use the default model (currently Opus 5.5)".into(),
                ..alias("default", "Default (recommended)", "claude-opus-5-5")
            },
            RawModel {
                description: "Opus 5.5 · Most capable".into(),
                ..alias("opus", "Opus", "claude-opus-5-5")
            },
            alias("fable", "Fable 5.1", "claude-fable-5-1"),
            row("claude-opus-4-7", "Opus 4.7", ""),
            RawModel {
                description: "Use the default model (currently Haiku 5.5)".into(),
                ..alias("default", "Default", "claude-haiku-5-5")
            },
        ]);
        let name_of = |model: &str| {
            names
                .iter()
                .find(|(id, _)| id == model)
                .map(|(_, name)| name.as_str())
        };
        // A spawned agent's full id is named like the alias resolving to it.
        assert_eq!(name_of("claude-opus-5-5"), Some("Opus 5.5"));
        assert_eq!(name_of("opus"), Some("Opus 5.5"));
        assert_eq!(name_of("default"), Some("Default (Opus 5.5)"));
        assert_eq!(name_of("claude-fable-5-1"), Some("Fable 5.1"));
        assert_eq!(name_of("claude-opus-4-7"), Some("Opus 4.7"));
        // A model only `default` resolves to is named as its current model.
        assert_eq!(name_of("claude-haiku-5-5"), Some("Haiku 5.5"));
        assert_eq!(name_of("claude-unknown-1"), None);
    }

    #[test]
    fn the_cache_serves_prices_before_a_list_and_keeps_a_list_over_an_empty_one() {
        let mut cache = ModelCatalogCache::default();
        assert!(cache.models().is_empty());
        assert!(cache.prices().contains_key("claude-opus-5-5"));
        assert!(!cache.prices().contains_key("opus"));
        cache.update(vec![alias("opus", "Opus", "claude-opus-5-5")]);
        assert!(cache.prices().contains_key("opus"));
        assert_eq!(cache.id_for("claude-opus-5-5"), "opus");
        cache.update(Vec::new());
        let catalog = cache.catalog();
        assert_eq!(
            catalog
                .models
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["opus"]
        );
        assert!(catalog.prices.contains_key("opus"));
    }
}
