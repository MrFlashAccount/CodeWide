//! `model/list` and `permissionProfile/list` across providers.
//!
//! The first page lists the primary provider's rows, then every other
//! provider's rows, each annotated with `codewideAgentProvider`. Exactly one
//! row is the default (the primary's), at most 100 rows are returned, and a
//! duplicate model id keeps the earlier provider's row. Non-primary model
//! names are labelled `"<Provider> · <displayName>"`. A single-provider host
//! keeps the lead response unchanged.

use std::collections::HashSet;

use serde_json::{Value, json};

use super::{PROFILE_PROVIDERS_FIELD, PROVIDER_FIELD, PROVIDERS_UNAVAILABLE_FIELD, WireProvider};
use crate::agent::model::{ModelEntry, PermissionProfileEntry, ProviderId};

const MAX_MODEL_ROWS: usize = 100;

fn model_row(entry: &ModelEntry, provider: &WireProvider) -> Value {
    json!({
        "id": entry.id,
        "model": entry.model,
        "upgrade": null,
        "upgradeInfo": null,
        "availabilityNux": null,
        "displayName": format!("{} · {}", provider.descriptor.display_name, entry.display_name),
        "description": entry.description,
        "modelSpecialty": null,
        "hidden": entry.hidden,
        "supportedReasoningEfforts": entry.efforts.iter().map(|effort| json!({
            "reasoningEffort": effort.effort,
            "description": effort.description,
        })).collect::<Vec<_>>(),
        "defaultReasoningEffort": entry.default_effort,
        "inputModalities": entry.input_modalities,
        "supportsPersonality": false,
        "multiAgentVersion": null,
        "additionalSpeedTiers": [],
        "serviceTiers": [],
        "defaultServiceTier": null,
        "isDefault": false,
        PROVIDER_FIELD: provider.descriptor.id.as_str(),
    })
}

/// Merges other providers' models into the lead `model/list` result.
/// `others` holds each non-lead provider with its catalog (already fetched;
/// providers that failed are omitted).
#[must_use]
pub fn merge_models(
    mut lead_result: Value,
    primary: &WireProvider,
    others: &[(WireProvider, Vec<ModelEntry>)],
    first_page: bool,
) -> Value {
    if !primary.multi_provider {
        return lead_result;
    }
    let Some(rows) = lead_result.get_mut("data").and_then(Value::as_array_mut) else {
        return lead_result;
    };
    let mut seen = HashSet::new();
    let mut default_seen = false;
    for row in rows.iter_mut() {
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            seen.insert(id.to_owned());
        }
        if let Some(object) = row.as_object_mut() {
            object.insert(PROVIDER_FIELD.into(), json!(primary.descriptor.id.as_str()));
            let is_default = object.get("isDefault").and_then(Value::as_bool) == Some(true);
            if is_default && default_seen {
                object.insert("isDefault".into(), json!(false));
            }
            default_seen |= is_default;
        }
    }
    if first_page {
        for (provider, models) in others {
            for entry in models {
                if rows.len() >= MAX_MODEL_ROWS {
                    break;
                }
                if seen.insert(entry.id.clone()) {
                    rows.push(model_row(entry, provider));
                }
            }
        }
    }
    rows.truncate(MAX_MODEL_ROWS);
    lead_result
}

/// Names the providers whose rows a merged catalog answer lacks, so the
/// client keeps retrying instead of caching an incomplete catalog. Nothing
/// is attached when every provider answered.
pub fn attach_unavailable(result: &mut Value, unavailable: &[ProviderId]) {
    if unavailable.is_empty() {
        return;
    }
    if let Some(object) = result.as_object_mut() {
        object.insert(
            PROVIDERS_UNAVAILABLE_FIELD.into(),
            json!(
                unavailable
                    .iter()
                    .map(ProviderId::as_str)
                    .collect::<Vec<_>>()
            ),
        );
    }
}

/// Annotates profile rows with the providers that offer them and appends
/// profiles only other providers offer.
#[must_use]
pub fn merge_permission_profiles(
    mut lead_result: Value,
    primary: &WireProvider,
    others: &[(WireProvider, Vec<PermissionProfileEntry>)],
) -> Value {
    if !primary.multi_provider {
        return lead_result;
    }
    let Some(rows) = lead_result.get_mut("data").and_then(Value::as_array_mut) else {
        return lead_result;
    };
    let offering = |id: &str| {
        others
            .iter()
            .filter(|(_, profiles)| profiles.iter().any(|profile| profile.id == id))
            .map(|(provider, _)| provider.descriptor.id.as_str().to_owned())
            .collect::<Vec<_>>()
    };
    let mut listed = HashSet::new();
    for row in rows.iter_mut() {
        let Some(id) = row.get("id").and_then(Value::as_str).map(str::to_owned) else {
            continue;
        };
        let mut providers = vec![primary.descriptor.id.as_str().to_owned()];
        providers.extend(offering(&id));
        if let Some(object) = row.as_object_mut() {
            object.insert(PROFILE_PROVIDERS_FIELD.into(), json!(providers));
        }
        listed.insert(id);
    }
    for (_, profiles) in others {
        for profile in profiles {
            if listed.insert(profile.id.clone()) {
                rows.push(json!({
                    "id": profile.id,
                    "description": profile.description,
                    "allowed": true,
                    PROFILE_PROVIDERS_FIELD: offering(&profile.id),
                }));
            }
        }
    }
    lead_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::{
        CapabilitySet, InputModality, ModelEffort, ProviderDescriptor, ProviderId,
        StartWhileActiveMode,
    };

    fn wire(id: &'static str, name: &str, multi: bool) -> WireProvider {
        WireProvider {
            descriptor: ProviderDescriptor {
                id: ProviderId::from_static(id),
                display_name: name.into(),
                model_provider: id.into(),
                version: String::new(),
            },
            capabilities: CapabilitySet::none(StartWhileActiveMode::Busy),
            primary_id: ProviderId::from_static("codex"),
            multi_provider: multi,
        }
    }

    fn entry(id: &str, default: bool) -> ModelEntry {
        ModelEntry {
            id: id.into(),
            model: id.into(),
            display_name: "Default (recommended)".into(),
            description: String::new(),
            is_default: default,
            hidden: false,
            efforts: vec![ModelEffort {
                effort: "high".into(),
                description: String::new(),
            }],
            default_effort: Some("high".into()),
            input_modalities: vec![InputModality::Text],
        }
    }

    #[test]
    fn single_provider_model_list_is_unchanged() {
        let lead = json!({"data": [{"id": "gpt", "isDefault": true}], "nextCursor": null});
        assert_eq!(
            merge_models(lead.clone(), &wire("codex", "Codex", false), &[], true),
            lead
        );
    }

    #[test]
    fn merged_models_keep_one_default_label_and_annotate_rows() {
        let lead = json!({"data": [{"id": "gpt", "isDefault": true}], "nextCursor": null});
        let merged = merge_models(
            lead,
            &wire("codex", "Codex", true),
            &[(
                wire("claude", "Claude", true),
                vec![entry("default", true), entry("gpt", false)],
            )],
            true,
        );
        let rows = merged["data"].as_array().cloned().unwrap_or_default();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][PROVIDER_FIELD], "codex");
        assert_eq!(rows[1][PROVIDER_FIELD], "claude");
        assert_eq!(rows[1]["displayName"], "Claude · Default (recommended)");
        assert_eq!(
            rows.iter().filter(|row| row["isDefault"] == true).count(),
            1
        );
    }

    #[test]
    fn profiles_are_annotated_with_their_providers() {
        let lead = json!({"data": [{"id": ":workspace", "description": null, "allowed": true}], "nextCursor": null});
        let merged = merge_permission_profiles(
            lead,
            &wire("codex", "Codex", true),
            &[(
                wire("claude", "Claude", true),
                vec![
                    PermissionProfileEntry {
                        id: ":workspace".into(),
                        display_name: "Workspace".into(),
                        description: String::new(),
                    },
                    PermissionProfileEntry {
                        id: ":plan".into(),
                        display_name: "Plan".into(),
                        description: "Plan only".into(),
                    },
                ],
            )],
        );
        assert_eq!(
            merged["data"][0][PROFILE_PROVIDERS_FIELD],
            json!(["codex", "claude"])
        );
        assert_eq!(merged["data"][1]["id"], ":plan");
        assert_eq!(
            merged["data"][1][PROFILE_PROVIDERS_FIELD],
            json!(["claude"])
        );
    }
}
