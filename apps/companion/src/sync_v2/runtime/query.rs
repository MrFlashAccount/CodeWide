//! Bounded semantic queries.

use crate::auth::AuthorizationContext;
use axum::extract::ws::WebSocket;

use super::SyncV2Runtime;
use crate::sync_v2::{
    auth_context::AuthenticatedContextKey,
    epoch::ConnectionEpoch,
    protocol::{ErrorCode, Query, QueryResult, Recovery, ReinitializeReason, ServerFrame, V2Error},
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
        if let Query::OperationGet { operation_id } = query {
            let frame = match self.ledger.receipt(context, &operation_id) {
                Ok(Some(receipt)) => ServerFrame::QueryCompleted {
                    request_id,
                    result: QueryResult::OperationGet {
                        operation_id,
                        receipt: Box::new(receipt),
                    },
                },
                Ok(None) => ServerFrame::QueryFailed {
                    request_id,
                    error: V2Error {
                        code: ErrorCode::NotFound,
                        recovery: Recovery::Requery,
                        message: "operation receipt was not found".into(),
                    },
                },
                Err(_) => ServerFrame::QueryFailed {
                    request_id,
                    error: V2Error::source_unavailable("operation ledger is unavailable"),
                },
            };
            return self.send_frame(socket, &frame).await.is_ok();
        }
        let query_kind = query.kind();
        let frame = match query.validate(self.limits) {
            Ok(()) => {
                if let Err(error) = ensure_generation(self.source.as_ref(), epoch.generation) {
                    let frame = ServerFrame::QueryFailed { request_id, error };
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
        self.send_frame(socket, &frame).await.is_ok()
    }
}
