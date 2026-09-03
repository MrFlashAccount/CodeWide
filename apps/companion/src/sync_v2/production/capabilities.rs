//! Scope authorization and capability projection for the production V2 source.

use crate::{
    auth::AuthorizationContext,
    sync_v2::{
        domain::SnapshotLimits,
        protocol::{
            COMMAND_KINDS, Command, QUERY_KINDS, Query, QueryResult, V2Error,
            command_required_scope, command_scope_for_kind, query_required_scope,
            query_scope_for_kind,
        },
    },
};

pub(super) fn require_scope(
    authorization: &AuthorizationContext,
    scope: &str,
) -> Result<(), V2Error> {
    match authorization {
        AuthorizationContext::Admin => Ok(()),
        AuthorizationContext::Session { scopes, .. }
            if scopes.iter().any(|candidate| candidate == scope) =>
        {
            Ok(())
        }
        AuthorizationContext::Session { .. } | AuthorizationContext::Device { .. } => {
            Err(V2Error::forbidden(format!("{scope} scope is required")))
        }
    }
}

pub(super) fn command_scope(command: &Command) -> &'static str {
    command_required_scope(command)
}

#[cfg(test)]
pub(super) fn query_scope(query: &Query) -> &'static str {
    let Some(scope) = query_required_scope(query) else {
        unreachable!("operation.get authority is resolved from its durable operation record")
    };
    scope
}

pub(super) fn authorize_query(
    authorization: &AuthorizationContext,
    query: &Query,
) -> Result<(), V2Error> {
    let Some(scope) = query_required_scope(query) else {
        return Err(V2Error::invalid_query());
    };
    require_scope(authorization, scope)
}

pub(super) fn authorize_command(
    authorization: &AuthorizationContext,
    command: &Command,
) -> Result<(), V2Error> {
    require_scope(authorization, command_scope(command))
}

pub(super) fn capabilities(
    limits: SnapshotLimits,
    authorization: &AuthorizationContext,
    accounts_available: bool,
) -> QueryResult {
    let commands = COMMAND_KINDS
        .iter()
        .filter_map(|kind| {
            if command_kind_is_authorized(authorization, kind)
                && (accounts_available || !kind.starts_with("account."))
            {
                Some((*kind).to_owned())
            } else {
                None
            }
        })
        .collect();
    let queries = QUERY_KINDS
        .iter()
        .filter_map(|kind| {
            if query_kind_is_authorized(authorization, kind)
                && (accounts_available || *kind != "accounts.list")
            {
                Some((*kind).to_owned())
            } else {
                None
            }
        })
        .collect();
    QueryResult::CapabilitiesRead {
        commands,
        queries,
        limits,
    }
}

fn command_kind_is_authorized(authorization: &AuthorizationContext, kind: &str) -> bool {
    let base_scope_is_authorized = command_scope_for_kind(kind)
        .is_some_and(|scope| require_scope(authorization, scope).is_ok());
    base_scope_is_authorized
        || (kind == "queue.mutate"
            && (require_scope(authorization, "turns.start").is_ok()
                || require_scope(authorization, "turns.steer").is_ok()))
}

fn query_kind_is_authorized(authorization: &AuthorizationContext, kind: &str) -> bool {
    query_scope_for_kind(kind).is_some_and(|scope| require_scope(authorization, scope).is_ok())
        || (kind == "operation.get"
            && COMMAND_KINDS
                .iter()
                .any(|command_kind| command_kind_is_authorized(authorization, command_kind)))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::{Value, json};

    use super::*;
    use crate::auth::contract_device_scopes;

    fn session(scopes: &[&str]) -> AuthorizationContext {
        AuthorizationContext::Session {
            device_id: "device".into(),
            scopes: scopes.iter().map(ToString::to_string).collect(),
            expires_at: u64::MAX,
        }
    }

    fn query(value: Value) -> Query {
        serde_json::from_value(value)
            .unwrap_or_else(|error| panic!("invalid query test case: {error}"))
    }

    fn command(value: Value) -> Command {
        serde_json::from_value(value)
            .unwrap_or_else(|error| panic!("invalid command test case: {error}"))
    }

    fn query_cases() -> Vec<Query> {
        vec![
            query(json!({"kind":"capabilities.read"})),
            query(json!({"kind":"models.list"})),
            query(json!({"kind":"skills.list","workspace":"/tmp","forceReload":false})),
            query(json!({"kind":"thread.goal","threadId":"thread"})),
            query(json!({"kind":"thread.agents","threadId":"thread","cursor":null,"limit":1})),
            query(json!({"kind":"catalog.page","partition":"active","before":null,"limit":1})),
            query(
                json!({"kind":"catalog.search","partition":"active","text":"needle","cursor":null,"limit":1}),
            ),
            query(
                json!({"kind":"history.page","threadId":"thread","cursor":null,"direction":"older","limit":1,"detail":"summary"}),
            ),
            query(
                json!({"kind":"turn.items","threadId":"thread","turnId":"turn","cursor":null,"limit":1}),
            ),
            query(
                json!({"kind":"item.output","threadId":"thread","turnId":"turn","itemId":"item","cursor":null,"limitBytes":4}),
            ),
            query(
                json!({"kind":"thread.resources","threadId":"thread","scope":"session","cursor":null,"limit":1}),
            ),
            query(json!({"kind":"workspace.file","threadId":"thread","path":"src/main.rs"})),
            query(
                json!({"kind":"thread.change","threadId":"thread","path":"src/main.rs","scope":"session"}),
            ),
            query(
                json!({"kind":"thread.changeOutput","threadId":"thread","path":"src/main.rs","scope":"session","cursor":null,"limitBytes":4}),
            ),
            query(json!({"kind":"projects.list"})),
            query(json!({"kind":"workspace.inspect","path":"/tmp"})),
            query(json!({"kind":"queue.list","threadId":null,"cursor":null,"limit":1})),
            query(json!({"kind":"operation.get","operationId":"operation"})),
            query(json!({"kind":"accounts.list"})),
            query(json!({"kind":"thread.processes","threadId":"thread","cursor":null,"limit":1})),
        ]
    }

    fn command_cases() -> Vec<Command> {
        let settings = json!({
            "model": null,
            "effort": null,
            "approvalPolicy": "never",
            "sandbox": "readOnly",
            "personality": null
        });
        vec![
            command(
                json!({"kind":"thread.create","workspace":"/tmp","title":null,"settings":settings}),
            ),
            command(json!({"kind":"thread.fork","threadId":"thread","throughTurnId":null})),
            command(
                json!({"kind":"thread.update","threadId":"thread","change":{"kind":"title","title":null}}),
            ),
            command(json!({"kind":"thread.delete","threadId":"thread"})),
            command(
                json!({"kind":"thread.markRead","threadId":"thread","throughActivityMarker":"marker"}),
            ),
            command(
                json!({"kind":"turn.submit","threadId":null,"workspace":"/tmp","input":[{"kind":"text","text":"hello"}],"intent":"chat","settings":null}),
            ),
            command(
                json!({"kind":"turn.steer","threadId":"thread","turnId":"turn","input":[{"kind":"text","text":"hello"}]}),
            ),
            command(
                json!({"kind":"review.start","threadId":"thread","target":{"kind":"uncommittedChanges"},"delivery":null}),
            ),
            command(json!({"kind":"turn.interrupt","threadId":"thread","turnId":"turn"})),
            command(json!({"kind":"thread.compact","threadId":"thread"})),
            command(
                json!({"kind":"thread.rollback","threadId":"thread","throughTurnId":null,"dropFollowingTurns":true}),
            ),
            command(json!({"kind":"project.add","path":"/tmp","name":null,"pinned":false})),
            command(
                json!({"kind":"workspace.create","provider":"provider","parentPath":"/tmp","name":"workspace"}),
            ),
            command(
                json!({"kind":"queue.mutate","mutation":{"kind":"put","threadId":"thread","input":[{"kind":"text","text":"hello"}]}}),
            ),
            command(
                json!({"kind":"queue.mutate","mutation":{"kind":"steer","itemId":"item","turnId":"turn","expectedRevision":"revision"}}),
            ),
            command(
                json!({"kind":"account.update","change":{"kind":"activate","profileId":"profile"}}),
            ),
            command(json!({"kind":"account.login.start"})),
            command(json!({"kind":"account.login.cancel","loginId":"login"})),
            command(json!({"kind":"process.terminate","threadId":"thread","processId":"process"})),
            command(
                json!({"kind":"request.resolve","requestId":"request","generation":"1","resolution":{"kind":"commandApproval","decision":"accept"}}),
            ),
        ]
    }

    #[test]
    fn advertised_capabilities_exactly_follow_query_and_command_authorization() {
        let queries = query_cases();
        let commands = command_cases();
        for kind in QUERY_KINDS {
            assert_eq!(
                queries.iter().filter(|query| query.kind() == *kind).count(),
                1,
                "query authorization table must cover {kind} exactly once"
            );
        }
        for kind in COMMAND_KINDS {
            assert!(
                commands.iter().any(|command| command.kind() == *kind),
                "command authorization table must cover {kind}"
            );
        }

        let profiles = vec![
            ("full", session(contract_device_scopes())),
            ("none", session(&[])),
            ("thread reader", session(&["threads.read"])),
            ("thread writer", session(&["threads.write"])),
            ("file reader", session(&["files.download.workspace"])),
            ("file writer", session(&["files.upload.workspace"])),
            ("turn starter", session(&["turns.start"])),
            ("turn steerer", session(&["turns.steer"])),
            ("process manager", session(&["processes.manage"])),
            ("approval responder", session(&["approvals.respond"])),
            ("account reader", session(&["accounts.read"])),
            ("account manager", session(&["accounts.manage"])),
        ];

        for (profile, authorization) in profiles {
            let QueryResult::CapabilitiesRead {
                commands: advertised_commands,
                queries: advertised_queries,
                ..
            } = capabilities(SnapshotLimits::default(), &authorization, true)
            else {
                panic!("expected capabilities result");
            };
            let advertised_queries = advertised_queries
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            let advertised_commands = advertised_commands
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();

            for kind in QUERY_KINDS {
                let authorized = if *kind == "operation.get" {
                    commands
                        .iter()
                        .any(|command| authorize_command(&authorization, command).is_ok())
                } else {
                    queries
                        .iter()
                        .filter(|query| query.kind() == *kind)
                        .any(|query| authorize_query(&authorization, query).is_ok())
                };
                assert_eq!(
                    advertised_queries.contains(kind),
                    authorized,
                    "query capability drift for {kind} in {profile} profile"
                );
            }
            for kind in COMMAND_KINDS {
                let authorized = commands
                    .iter()
                    .filter(|command| command.kind() == *kind)
                    .any(|command| authorize_command(&authorization, command).is_ok());
                assert_eq!(
                    advertised_commands.contains(kind),
                    authorized,
                    "command capability drift for {kind} in {profile} profile"
                );
            }
        }
    }

    #[test]
    fn account_service_availability_preserves_independent_scope_split() {
        let reader = session(&["accounts.read"]);
        let manager = session(&["accounts.manage"]);

        let QueryResult::CapabilitiesRead {
            commands: reader_commands,
            queries: reader_queries,
            ..
        } = capabilities(SnapshotLimits::default(), &reader, true)
        else {
            panic!("expected capabilities result");
        };
        assert!(reader_queries.iter().any(|kind| kind == "accounts.list"));
        assert!(
            !reader_commands
                .iter()
                .any(|kind| kind.starts_with("account."))
        );

        let QueryResult::CapabilitiesRead {
            commands: manager_commands,
            queries: manager_queries,
            ..
        } = capabilities(SnapshotLimits::default(), &manager, true)
        else {
            panic!("expected capabilities result");
        };
        assert!(manager_commands.iter().any(|kind| kind == "account.update"));
        assert!(!manager_queries.iter().any(|kind| kind == "accounts.list"));

        let QueryResult::CapabilitiesRead {
            commands: unavailable_commands,
            queries: unavailable_queries,
            ..
        } = capabilities(
            SnapshotLimits::default(),
            &session(&["accounts.read", "accounts.manage"]),
            false,
        )
        else {
            panic!("expected capabilities result");
        };
        assert!(
            !unavailable_commands
                .iter()
                .any(|kind| kind.starts_with("account."))
        );
        assert!(
            !unavailable_queries
                .iter()
                .any(|kind| kind == "accounts.list")
        );
    }
}
