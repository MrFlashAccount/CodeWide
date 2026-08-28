//! Bounded semantic queries.

use crate::auth::AuthorizationContext;
use axum::extract::ws::WebSocket;

use super::SyncV2Runtime;
use crate::sync_v2::{
    auth_context::AuthenticatedContextKey,
    epoch::ConnectionEpoch,
    protocol::{Query, ReinitializeReason, ServerFrame, V2Error},
    scalar::Id,
    source::ensure_generation,
};

impl SyncV2Runtime {
    pub(super) async fn handle_query(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        epoch: &mut ConnectionEpoch,
        request_id: Id,
        query: Query,
    ) -> bool {
        let query_kind = query.kind();
        let frame = match query.validate(self.limits) {
            Ok(()) => {
                if let Err(error) = ensure_generation(self.source.as_ref(), epoch.generation) {
                    let frame = bound_query_frame(
                        ServerFrame::QueryFailed { request_id, error },
                        self.limits.snapshot_max_bytes as usize,
                    );
                    return self.send_frame(socket, &frame).await.is_ok();
                }
                match tokio::time::timeout(
                    self.source_deadline,
                    self.source
                        .query(query, authorization, context, epoch.generation),
                )
                .await
                {
                    Ok(Ok(result)) if result.kind() == query_kind => {
                        ServerFrame::QueryCompleted { request_id, result }
                    }
                    Ok(Ok(_)) => {
                        self.reinitialize(socket, epoch, ReinitializeReason::SourceGap)
                            .await;
                        return true;
                    }
                    Ok(Err(error)) => ServerFrame::QueryFailed { request_id, error },
                    Err(_) => ServerFrame::QueryFailed {
                        request_id,
                        error: V2Error::source_unavailable("query source deadline exceeded"),
                    },
                }
            }
            Err(error) => ServerFrame::QueryFailed { request_id, error },
        };
        let frame = bound_query_frame(frame, self.limits.snapshot_max_bytes as usize);
        self.send_frame(socket, &frame).await.is_ok()
    }
}

fn bound_query_frame(frame: ServerFrame, max_bytes: usize) -> ServerFrame {
    if serialized_len(&frame).is_some_and(|bytes| bytes <= max_bytes) {
        return frame;
    }
    match frame {
        ServerFrame::QueryCompleted { request_id, .. } => ServerFrame::QueryFailed {
            request_id,
            error: V2Error::source_unavailable("query result exceeded byte limit"),
        },
        other => other,
    }
}

fn serialized_len(value: &impl serde::Serialize) -> Option<usize> {
    serde_json::to_vec(value).ok().map(|encoded| encoded.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_v2::{
        domain::SnapshotLimits,
        protocol::{ErrorCode, QueryResult},
    };

    #[test]
    fn oversized_query_result_becomes_a_closed_public_failure() {
        let frame = ServerFrame::QueryCompleted {
            request_id: Id::new("query").unwrap_or_else(|error| panic!("invalid test id: {error}")),
            result: QueryResult::CapabilitiesRead {
                commands: vec!["x".repeat(4_096)],
                queries: Vec::new(),
                actions: Vec::new(),
                limits: SnapshotLimits::default(),
            },
        };
        assert!(matches!(
            bound_query_frame(frame, 256),
            ServerFrame::QueryFailed { error, .. }
                if error.code == ErrorCode::SourceUnavailable
        ));
    }
}
