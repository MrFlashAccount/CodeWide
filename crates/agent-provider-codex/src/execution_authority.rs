//! Durable execution authority recorded in a Codex rollout.
//!
//! An App Server `thread/read` can omit `activePermissionProfile` for a
//! thread created by another client or before the companion connected. The
//! rollout's `thread_settings_applied` event is the provider-owned durable
//! record of the settings that actually govern that thread.

use std::{
    fs::File,
    io::{self, BufRead, BufReader},
    path::Path,
};

use agent_core::provider::{
    ExecutionApproval, ExecutionPolicy, ExecutionReviewer, ExecutionSandbox,
    ThreadExecutionAuthority,
};
use serde::Deserialize;

const SETTINGS_EVENT: &[u8] = b"thread_settings_applied";
const FULL_ACCESS: &str = ":danger-full-access";

#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    kind: String,
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type")]
    kind: String,
    thread_settings: Option<serde_json::Value>,
}

/// Reads the newest valid execution authority from `path`.
pub(super) fn read(path: &Path) -> io::Result<Option<ThreadExecutionAuthority>> {
    let mut authority = None;
    for line in BufReader::new(File::open(path)?).split(b'\n') {
        let line = line?;
        if memchr::memmem::find(&line, SETTINGS_EVENT).is_none() {
            continue;
        }
        let Ok(envelope) = serde_json::from_slice::<Envelope>(&line) else {
            continue;
        };
        let Some(payload) = envelope.payload.filter(|payload| {
            envelope.kind == "event_msg" && payload.kind == "thread_settings_applied"
        }) else {
            continue;
        };
        if let Some(settings) = payload.thread_settings {
            // A later ambiguous setting invalidates an older authority. Keeping
            // the older (possibly broader) ceiling would permit escalation.
            authority = authority_from(&settings);
        }
    }
    Ok(authority)
}

fn authority_from(settings: &serde_json::Value) -> Option<ThreadExecutionAuthority> {
    let named = settings
        .pointer("/active_permission_profile/id")
        .and_then(serde_json::Value::as_str)
        .filter(|profile| !profile.trim().is_empty())
        .map(str::to_owned);
    let unrestricted = settings
        .pointer("/permission_profile/type")
        .and_then(serde_json::Value::as_str)
        == Some("disabled");
    let permission_profile = named
        .clone()
        .or_else(|| unrestricted.then(|| FULL_ACCESS.into()))?;
    let sandbox = if named.is_some() {
        ExecutionSandbox::ConfiguredProfile
    } else {
        ExecutionSandbox::Unrestricted
    };
    let approval = settings
        .get("approval_policy")
        .cloned()
        .and_then(|value| serde_json::from_value::<ExecutionApproval>(value).ok());
    let reviewer = settings
        .get("approvals_reviewer")
        .cloned()
        .and_then(|value| serde_json::from_value::<ExecutionReviewer>(value).ok());
    let policy = approval
        .zip(reviewer)
        .map(|(approval, reviewer)| ExecutionPolicy {
            sandbox,
            approval,
            reviewer,
        });
    Some(ThreadExecutionAuthority {
        permission_profile,
        policy,
    })
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn rollout(lines: &[&str]) -> io::Result<tempfile::NamedTempFile> {
        let mut file = tempfile::NamedTempFile::new()?;
        for line in lines {
            writeln!(file, "{line}")?;
        }
        Ok(file)
    }

    #[test]
    fn newest_named_profile_is_the_durable_authority() -> Result<(), Box<dyn std::error::Error>> {
        let file = rollout(&[
            r#"{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"active_permission_profile":{"id":":workspace"},"permission_profile":{"type":"managed"},"approval_policy":"never","approvals_reviewer":"user"}}}"#,
            r#"{"type":"response_item","payload":{"type":"message","content":"ignored"}}"#,
            r#"{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"active_permission_profile":{"id":":danger-full-access"},"permission_profile":{"type":"disabled"},"approval_policy":"never","approvals_reviewer":"auto_review"}}}"#,
        ])?;
        assert_eq!(
            read(file.path())?,
            Some(ThreadExecutionAuthority {
                permission_profile: FULL_ACCESS.into(),
                policy: Some(ExecutionPolicy {
                    sandbox: ExecutionSandbox::ConfiguredProfile,
                    approval: ExecutionApproval::Never,
                    reviewer: ExecutionReviewer::AutoReview,
                }),
            })
        );
        Ok(())
    }

    #[test]
    fn disabled_native_permissions_prove_unrestricted_without_a_named_profile()
    -> Result<(), Box<dyn std::error::Error>> {
        let file = rollout(&[
            r#"{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"active_permission_profile":null,"permission_profile":{"type":"disabled"},"approval_policy":"never","approvals_reviewer":"user"}}}"#,
        ])?;
        assert_eq!(
            read(file.path())?,
            Some(ThreadExecutionAuthority {
                permission_profile: FULL_ACCESS.into(),
                policy: Some(ExecutionPolicy {
                    sandbox: ExecutionSandbox::Unrestricted,
                    approval: ExecutionApproval::Never,
                    reviewer: ExecutionReviewer::User,
                }),
            })
        );
        Ok(())
    }

    #[test]
    fn managed_permissions_without_an_effective_profile_stay_unknown()
    -> Result<(), Box<dyn std::error::Error>> {
        let file = rollout(&[
            r#"{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"active_permission_profile":{"id":":danger-full-access"},"permission_profile":{"type":"disabled"},"approval_policy":"never","approvals_reviewer":"user"}}}"#,
            r#"{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"active_permission_profile":null,"permission_profile":{"type":"managed"},"approval_policy":"never","approvals_reviewer":"user"}}}"#,
        ])?;
        assert_eq!(read(file.path())?, None);
        Ok(())
    }
}
