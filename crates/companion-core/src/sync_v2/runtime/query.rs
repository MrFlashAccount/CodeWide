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
            let frame = match self.ledger.authorized_receipt(context, &operation_id) {
                Ok(Some(receipt)) => ServerFrame::QueryCompleted {
                    request_id,
                    result: QueryResult::OperationGet {
                        operation_id,
                        receipt: Box::new(receipt),
                    },
                },
                Ok(None) => {
                    operation_receipt_not_found(request_id, "operation receipt was not found")
                }
                Err(error) if error.is_permanently_unreadable_receipt() => {
                    operation_receipt_not_found(request_id, "operation receipt is unreadable")
                }
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
                #[cfg(feature = "e2e-command-fault")]
                if let Some(error) = self.e2e_query_fault(&query).await {
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

    #[cfg(feature = "e2e-command-fault")]
    async fn e2e_query_fault(&self, query: &Query) -> Option<V2Error> {
        use crate::sync_v2::{E2ESurfaceFaultEffect, E2ESurfaceFaultTarget};

        let effect = match query {
            Query::CatalogPage {
                before: Some(_), ..
            } => {
                self.intercept_e2e_surface_fault(E2ESurfaceFaultTarget::CatalogPage)
                    .await
            }
            Query::HistoryPage { .. } => {
                self.intercept_e2e_surface_fault(E2ESurfaceFaultTarget::HistoryPage)
                    .await
            }
            Query::ThreadResources { .. } => {
                match self
                    .intercept_e2e_surface_fault(E2ESurfaceFaultTarget::ResourceList)
                    .await
                {
                    Some(effect) => Some(effect),
                    None => {
                        self.intercept_e2e_surface_fault(E2ESurfaceFaultTarget::ResourceRefresh)
                            .await
                    }
                }
            }
            Query::WorkspaceFile { .. } => {
                self.intercept_e2e_surface_fault(E2ESurfaceFaultTarget::ResourceRead)
                    .await
            }
            Query::ThreadChange { .. } | Query::ThreadChangeOutput { .. } => {
                self.intercept_e2e_surface_fault(E2ESurfaceFaultTarget::ChangeRead)
                    .await
            }
            _ => None,
        }?;
        match effect {
            E2ESurfaceFaultEffect::Continue => None,
            E2ESurfaceFaultEffect::Fail(marker) => Some(V2Error::source_unavailable(format!(
                "App Server error: {marker}"
            ))),
            E2ESurfaceFaultEffect::NotFound
            | E2ESurfaceFaultEffect::ReplayUnavailable
            | E2ESurfaceFaultEffect::InvalidCursor
            | E2ESurfaceFaultEffect::VoiceRetry(_)
            | E2ESurfaceFaultEffect::VoiceResult(_)
            | E2ESurfaceFaultEffect::PortExpire { .. }
            | E2ESurfaceFaultEffect::QueueUncertain(_) => Some(V2Error::source_unavailable(
                "E2E surface fault action did not match the query boundary",
            )),
        }
    }
}

fn operation_receipt_not_found(request_id: Id, message: &str) -> ServerFrame {
    ServerFrame::QueryFailed {
        request_id,
        error: V2Error {
            code: ErrorCode::NotFound,
            recovery: Recovery::Requery,
            message: message.into(),
        },
    }
}
