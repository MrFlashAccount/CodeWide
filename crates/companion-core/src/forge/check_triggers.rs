//! Manual starts belong to an exact check launch. Discovery is an on-demand
//! read, and authorization repeats the scoped read immediately before a write.

use std::collections::HashSet;

use forge_protocol::{
    ActionAnchor, CheckTriggersParams, ChecksParams, RawActionCatalog, capability, methods,
};
use serde::Deserialize;
use serde_json::Value;

use super::{
    ForgeContext,
    action_run::Addressed,
    actions::{
        ActionDescriptor, ActionKind, SCENARIO_ACTION_PREFIX, catalog_wire, parse_descriptor,
    },
    errors::{Confirmation, ForgeError},
    ids::HeadRevision,
    params,
    plugin_client::PluginSession,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRequest {
    pull_request: Value,
    head_revision: String,
}

pub(super) async fn read(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ReadRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    if context
        .declarations
        .get(&identity.plugin_id)
        .is_some_and(|declaration| !declaration.supports(capability::CHECK_TRIGGERS))
    {
        return Err(ForgeError::ProviderUnavailable {
            plugin_id: Some(identity.plugin_id),
            capability: Some(capability::CHECK_TRIGGERS.to_owned()),
            reason: "The provider does not support manual check triggers".into(),
        });
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let addressed = Addressed {
        key: &key,
        identity: &identity,
        account: &account,
    };
    let result = catalog_at(&mut session, &addressed, &head, None).await;
    session.shutdown().await;
    let actions = result.map_err(|error| context.observe(&account, error))?;
    serde_json::to_value(catalog_wire(head, &actions))
        .map_err(|_| ForgeError::internal("the check triggers could not be encoded"))
}

pub(super) async fn catalog_at(
    session: &mut PluginSession,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
    check: Option<&str>,
) -> Result<Vec<ActionDescriptor>, ForgeError> {
    let catalog: RawActionCatalog = session
        .call(
            methods::PULL_REQUEST_CHECK_TRIGGERS,
            &CheckTriggersParams {
                checks: ChecksParams {
                    account: addressed.account.account_ref(),
                    pr_ref: addressed.identity.pr_ref.clone(),
                    head_revision: head.as_str().to_owned(),
                },
                check_id: check.map(str::to_owned),
            },
        )
        .await
        .map_err(|error| addressed.map(error))?;
    let current = HeadRevision::parse(&catalog.head_revision).ok_or_else(|| {
        ForgeError::internal("the plugin returned an invalid trigger head revision")
    })?;
    if current != *head {
        return Err(ForgeError::StaleHead {
            head_revision: current,
            catalog: None,
        });
    }

    validated_actions(&catalog, check)
}

fn validated_actions(
    catalog: &RawActionCatalog,
    check: Option<&str>,
) -> Result<Vec<ActionDescriptor>, ForgeError> {
    let mut actions = Vec::new();
    let mut ids = HashSet::new();
    for raw in &catalog.actions {
        let Some(action) = parse_descriptor(raw) else {
            continue;
        };
        let Some(ActionAnchor::Checks { check_id }) = &action.anchor else {
            continue;
        };
        if check_id.trim().is_empty() || check.is_some_and(|id| id != check_id) {
            continue;
        }
        if action.kind != ActionKind::ManualTrigger
            || !action.enabled()
            || action.confirm != Confirmation::None
            || action.input.is_some()
            || raw.get("toggle").is_some_and(|value| !value.is_null())
            || action.action_id.starts_with(SCENARIO_ACTION_PREFIX)
        {
            continue;
        }
        if !ids.insert(&raw["actionId"]) {
            return Err(ForgeError::internal(
                "the plugin returned ambiguous check trigger identities",
            ));
        }
        actions.push(action);
    }
    actions.sort_by_key(|action| action.order);
    Ok(actions)
}
