//! Typed internal adapter used only by the closed V2 Voice transport.

use serde_json::json;

use std::sync::Arc;

use tokio::fs;

use super::{DictationError, DictationService};

pub(crate) enum FinishOutcome {
    Result(String),
    Retry { retry_after_ms: u64 },
}

pub(crate) struct VoiceBatch<'a> {
    pub(crate) sequence: u64,
    pub(crate) sample_rate: u32,
    pub(crate) num_channels: u16,
    pub(crate) samples_per_channel: u64,
    pub(crate) data: &'a str,
}

impl DictationService {
    pub(crate) async fn v2_start(
        &self,
        audience: &str,
        language: Option<&str>,
    ) -> Result<String, DictationError> {
        let _replacement = self.v2_start_lock.lock().await;
        let candidates = self
            .sessions
            .lock()
            .await
            .iter()
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect::<Vec<_>>();
        for (id, session) in candidates {
            if session.lock().await.client_id == audience {
                self.v2_cancel(audience, &id).await?;
            }
        }
        let value = self
            .create_session(audience, &json!({ "language": language }))
            .await?;
        value
            .get("sessionId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or(DictationError::Storage)
    }

    pub(crate) async fn v2_append(
        &self,
        audience: &str,
        session_id: &str,
        batch: VoiceBatch<'_>,
    ) -> Result<(), DictationError> {
        self.append(
            audience,
            &json!({
                "sessionId": session_id,
                "batchId": format!("v2-{}", batch.sequence),
                "chunks": [{
                    "sampleRate": batch.sample_rate,
                    "numChannels": batch.num_channels,
                    "samplesPerChannel": batch.samples_per_channel,
                    "data": batch.data
                }]
            }),
            true,
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn v2_finish(
        &self,
        audience: &str,
        session_id: &str,
    ) -> Result<FinishOutcome, DictationError> {
        let value = self
            .finish(audience, &json!({ "sessionId": session_id }))
            .await?;
        if let Some(text) = value.get("text").and_then(serde_json::Value::as_str) {
            return Ok(FinishOutcome::Result(text.to_owned()));
        }
        let retry_after_ms = value
            .get("retryAfterMs")
            .and_then(serde_json::Value::as_u64)
            .ok_or(DictationError::Storage)?;
        Ok(FinishOutcome::Retry { retry_after_ms })
    }

    pub(crate) async fn v2_cancel(
        &self,
        audience: &str,
        session_id: &str,
    ) -> Result<(), DictationError> {
        let candidate = self.sessions.lock().await.get(session_id).cloned();
        let Some(candidate) = candidate else {
            return Err(DictationError::Missing);
        };
        let directory = {
            let session = candidate.lock().await;
            if session.client_id != audience {
                return Err(DictationError::Missing);
            }
            session.directory.clone()
        };
        fs::remove_dir_all(&directory)
            .await
            .map_err(|_| DictationError::Storage)?;
        let mut sessions = self.sessions.lock().await;
        if sessions
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, &candidate))
        {
            sessions.remove(session_id);
        }
        Ok(())
    }
}
