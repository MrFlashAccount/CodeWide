fn diagnostic_ingress_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/diagnostics/reports/{report_id}",
            post(diagnostic_ingest),
        )
        // WHY: Reports stream directly to private disk. Numeric telemetry limits must not truncate crash evidence.
        .layer(DefaultBodyLimit::disable())
}

fn diagnostic_control_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/diagnostics/reports", get(diagnostic_list))
        .route("/v1/diagnostics/reports/{report_id}", get(diagnostic_read))
}

async fn diagnostic_ingest(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    use futures_util::StreamExt as _;
    use tokio::io::AsyncWriteExt as _;
    let Some(store) = state.services.diagnostics.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("origin").is_some() {
        return json_error(StatusCode::UNAUTHORIZED, "session_authorization_required");
    }
    let Some(context) = authenticated_session(&state, &headers).await else {
        return json_error(StatusCode::UNAUTHORIZED, "session_authorization_required");
    };
    let device_id = context.device_id().unwrap_or("local-admin").to_owned();
    let incoming = match store.incoming() {
        Ok(file) => file,
        Err(error) => return diagnostic_store_error(&error),
    };
    let writer = match incoming.reopen() {
        Ok(file) => file,
        Err(error) => return diagnostic_store_error(&error.into()),
    };
    let mut writer = tokio::fs::File::from_std(writer);
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            return json_error(StatusCode::BAD_REQUEST, "incomplete_diagnostic_report");
        };
        if let Err(error) = writer.write_all(&chunk).await {
            return diagnostic_store_error(&error.into());
        }
    }
    if let Err(error) = writer.flush().await {
        return diagnostic_store_error(&error.into());
    }
    drop(writer);
    match tokio::task::spawn_blocking(move || store.commit(&device_id, &report_id, &incoming)).await
    {
        Ok(Ok(receipt)) => (StatusCode::ACCEPTED, Json(receipt)).into_response(),
        Ok(Err(error)) => diagnostic_store_error(&error),
        Err(error) => {
            tracing::error!(err = ?error, "diagnostic commit task failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "diagnostic_store_failed")
        }
    }
}

async fn diagnostic_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(store) = state.services.diagnostics.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::task::spawn_blocking(move || store.list()).await {
        Ok(Ok(reports)) => Json(serde_json::json!({"reports": reports})).into_response(),
        Ok(Err(error)) => diagnostic_store_error(&error),
        Err(error) => {
            tracing::error!(err = ?error, "diagnostic query task failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "diagnostic_store_failed")
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticReadQuery {
    device_id: String,
}

async fn diagnostic_read(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
    Query(query): Query<DiagnosticReadQuery>,
    headers: HeaderMap,
) -> Response {
    if headers.get("origin").is_some() || !authorize_admin(&state.authorization, &headers).await {
        return json_error(StatusCode::UNAUTHORIZED, "admin_authorization_required");
    }
    let Some(store) = state.services.diagnostics.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let path = match store.report_path(&query.device_id, &report_id) {
        Ok(path) => path,
        Err(error) => return diagnostic_store_error(&error),
    };
    match tokio::fs::File::open(path).await {
        Ok(file) => (
            [
                ("content-type", "application/json"),
                ("cache-control", "no-store"),
            ],
            Body::from_stream(tokio_util::io::ReaderStream::new(file)),
        )
            .into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            StatusCode::NOT_FOUND.into_response()
        }
        Err(error) => diagnostic_store_error(&error.into()),
    }
}

fn diagnostic_store_error(error: &crate::diagnostics::DiagnosticStoreError) -> Response {
    use crate::diagnostics::DiagnosticStoreError;
    match error {
        DiagnosticStoreError::Invalid | DiagnosticStoreError::Json(_) => {
            json_error(StatusCode::BAD_REQUEST, "invalid_diagnostic_report")
        }
        DiagnosticStoreError::Conflict => {
            json_error(StatusCode::CONFLICT, "diagnostic_report_conflict")
        }
        DiagnosticStoreError::Io(_) => {
            tracing::error!(err = ?error, "diagnostic storage failed");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "diagnostic_store_failed")
        }
    }
}
