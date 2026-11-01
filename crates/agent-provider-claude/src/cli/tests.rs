//! A fake `claude` (a POSIX shell script) driven through [`ClaudeProcess`].

use std::{path::Path, time::Duration};

use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::{
    command::{QueryOptions, SessionIdentity, profile_options},
    process::{ClaudeProcess, ProcessError, ProcessEvent},
    protocol::{Author, ControlRequest, Priority},
};
use crate::test_scripts::fake_claude;

/// Answers the first control request, asks to run a tool, records every
/// line it reads into `stdin.log`, and ends when its input ends.
const FAKE_CLAUDE: &str = r#"#!/bin/sh
read -r init
printf '%s\n' "$init" >> stdin.log
printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"codewide-1","response":{"commands":[]}}}'
printf '%s\n' '{"type":"system","subtype":"init","session_id":"s1"}'
printf '%s\n' '{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"},"tool_use_id":"toolu_1"}}'
while read -r line; do
  printf '%s\n' "$line" >> stdin.log
  case "$line" in
    *set_permission_mode*) printf '%s\n' '{"type":"control_response","response":{"subtype":"error","request_id":"codewide-2","error":"unsupported mode"}}' ;;
  esac
done
echo "bye from claude" >&2
"#;

fn fake(directory: &Path, script: &str) -> QueryOptions {
    QueryOptions {
        executable: fake_claude(directory, script),
        cwd: directory.to_owned(),
        model: "opus".into(),
        effort: None,
        profile: profile_options(":workspace").unwrap_or_else(|| unreachable!()),
        identity: SessionIdentity::New("s1".into()),
        client_tools: true,
    }
}

async fn next(events: &mut mpsc::Receiver<ProcessEvent>) -> ProcessEvent {
    tokio::time::timeout(Duration::from_secs(10), events.recv())
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| panic!("the fake claude reported nothing"))
}

#[tokio::test]
async fn drives_the_control_protocol_and_reports_the_exit() {
    let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
    let options = fake(directory.path(), FAKE_CLAUDE);
    let (process, mut events) =
        ClaudeProcess::spawn(&options, &[]).unwrap_or_else(|error| panic!("{error}"));

    let init = process
        .initialize(&options.sdk_mcp_servers())
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(init, json!({"commands": []}));
    assert!(
        matches!(next(&mut events).await, ProcessEvent::Message(message) if message["subtype"] == "init")
    );
    let ProcessEvent::Request {
        request_id,
        request,
    } = next(&mut events).await
    else {
        panic!("expected a permission request");
    };
    assert!(
        matches!(request, ControlRequest::CanUseTool { ref tool_name, .. } if tool_name == "Bash")
    );
    process
        .respond(
            &request_id,
            Ok(&json!({"behavior": "allow", "updatedInput": {}})),
        )
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    process
        .send_user(
            &json!("hello"),
            Some("u1"),
            Priority::Queued,
            Author::Person,
        )
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(matches!(
        process.set_permission_mode("plan").await,
        Err(ProcessError::Rejected(error)) if error == "unsupported mode"
    ));

    process.close().await;
    assert_eq!(
        next(&mut events).await,
        ProcessEvent::Exited {
            error: Some("bye from claude".into())
        }
    );
    let written: Vec<Value> = std::fs::read_to_string(directory.path().join("stdin.log"))
        .unwrap_or_else(|error| panic!("{error}"))
        .lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|error| panic!("{error}")))
        .collect();
    assert_eq!(written[0]["request"]["subtype"], "initialize");
    assert_eq!(written[0]["request"]["sdkMcpServers"][0], "codewide");
    assert_eq!(written[1]["response"]["request_id"], "r1");
    assert_eq!(written[2]["message"]["content"], "hello");
    assert_eq!(written[3]["request"]["mode"], "plan");
}

#[tokio::test]
async fn a_request_to_an_ended_process_fails_instead_of_waiting() {
    let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
    let options = fake(directory.path(), "#!/bin/sh\nexit 0\n");
    let (process, mut events) =
        ClaudeProcess::spawn(&options, &[]).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(
        next(&mut events).await,
        ProcessEvent::Exited { error: None }
    );
    assert!(matches!(
        process.interrupt().await,
        Err(ProcessError::Io(_) | ProcessError::Ended)
    ));
}
