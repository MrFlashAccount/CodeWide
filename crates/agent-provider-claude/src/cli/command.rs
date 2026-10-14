//! The `claude` command line of one live session, as the Agent SDK builds it
//! for a streamed query: JSON lines in and out, partial messages, adaptive
//! thinking with summarized display, permission prompts answered over
//! stdio, and the session's model, effort, permission profile, tools,
//! setting sources and MCP servers. Pure.

use std::ffi::OsString;
use std::path::PathBuf;

use serde_json::json;

/// The in-process MCP server that carries the companion's client tools;
/// Claude calls its tools as `mcp__codewide__<tool>`.
pub const CLIENT_TOOL_SERVER: &str = crate::transcript::client_tools::CLIENT_TOOL_SERVER;

/// How a permission profile runs Claude (`host/src/permissions/profiles.ts`).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileOptions {
    /// `default`, `acceptEdits` or `bypassPermissions`.
    pub permission_mode: &'static str,
    /// Claude settings files the session loads; empty loads none.
    pub setting_sources: &'static [&'static str],
    pub allow_dangerously_skip_permissions: bool,
    /// Only the MCP servers passed on the command line.
    pub strict_mcp_config: bool,
    /// Built-in tools the session may use; `None` keeps Claude's preset.
    pub tools: Option<&'static [&'static str]>,
}

const ALL_SOURCES: [&str; 3] = ["user", "project", "local"];
/// The built-in tools of the read-only profile.
pub const READ_ONLY_TOOLS: [&str; 4] = ["Read", "Glob", "Grep", "LS"];

/// The options of a built-in permission profile; `None` for an unknown id.
#[must_use]
pub fn profile_options(profile: &str) -> Option<ProfileOptions> {
    match profile {
        ":read-only" => Some(ProfileOptions {
            permission_mode: "default",
            setting_sources: &[],
            allow_dangerously_skip_permissions: false,
            strict_mcp_config: true,
            tools: Some(&READ_ONLY_TOOLS),
        }),
        ":workspace" => Some(ProfileOptions {
            permission_mode: "acceptEdits",
            setting_sources: &ALL_SOURCES,
            allow_dangerously_skip_permissions: false,
            strict_mcp_config: false,
            tools: None,
        }),
        ":full-access" | ":danger-full-access" => Some(ProfileOptions {
            permission_mode: "bypassPermissions",
            setting_sources: &ALL_SOURCES,
            allow_dangerously_skip_permissions: true,
            strict_mcp_config: false,
            tools: None,
        }),
        _ => None,
    }
}

/// Which session the process runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionIdentity {
    /// A session Claude creates with this id.
    New(String),
    /// An existing session, continued.
    Resume(String),
    /// No session: a short-lived process that only answers `initialize`
    /// and control requests (the runtime probe). The process runs no model
    /// and offers no tools, so `model`, `effort` and `client_tools` are not
    /// passed.
    Probe,
}

/// Everything one `claude` process of a session is started with.
#[derive(Clone, Debug)]
pub struct QueryOptions {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub model: String,
    /// `low` … `max`; `None` keeps Claude's default.
    pub effort: Option<String>,
    pub profile: ProfileOptions,
    pub identity: SessionIdentity,
    /// Whether the companion's client tools are offered (as the
    /// [`CLIENT_TOOL_SERVER`] MCP server).
    pub client_tools: bool,
}

const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// The probe runs with Claude's default permission mode, no settings files
/// and only the MCP servers on its command line (none), as the Agent SDK
/// probe did (`host/src/claude/sdkRuntime.ts`).
const PROBE_PROFILE: ProfileOptions = ProfileOptions {
    permission_mode: "default",
    setting_sources: &[],
    allow_dangerously_skip_permissions: false,
    strict_mcp_config: true,
    tools: None,
};

impl QueryOptions {
    /// The options of a runtime probe ([`SessionIdentity::Probe`]) in `cwd`.
    #[must_use]
    pub fn probe(executable: PathBuf, cwd: PathBuf) -> Self {
        Self {
            executable,
            cwd,
            model: String::new(),
            effort: None,
            profile: PROBE_PROFILE,
            identity: SessionIdentity::Probe,
            client_tools: false,
        }
    }

    /// The arguments after the executable.
    #[must_use]
    pub fn args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = [
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--thinking=adaptive",
            "--thinking-display",
            "summarized",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        let session = self.identity != SessionIdentity::Probe;
        if let Some(effort) = self
            .effort
            .as_deref()
            .filter(|effort| EFFORTS.contains(effort))
        {
            push(&mut args, "--effort", effort);
        }
        if session {
            push(&mut args, "--model", &self.model);
            args.push("--permission-prompt-tool=stdio".into());
        }
        match &self.identity {
            SessionIdentity::New(id) => push(&mut args, "--session-id", id),
            SessionIdentity::Resume(id) => push(&mut args, "--resume", id),
            SessionIdentity::Probe => {}
        }
        match self.profile.tools {
            Some(tools) => push(&mut args, "--tools", &tools.join(",")),
            None if session => args.push("--tools=default".into()),
            None => {}
        }
        // Under a strict MCP configuration (read-only) this is the only
        // MCP server the session loads.
        if self.client_tools && session {
            let config = json!({"mcpServers": {CLIENT_TOOL_SERVER: {"type": "sdk", "name": CLIENT_TOOL_SERVER}}});
            push(&mut args, "--mcp-config", &config.to_string());
        }
        push(
            &mut args,
            "--setting-sources",
            &self.profile.setting_sources.join(","),
        );
        if self.profile.strict_mcp_config {
            args.push("--strict-mcp-config".into());
        }
        push(&mut args, "--permission-mode", self.profile.permission_mode);
        if self.profile.allow_dangerously_skip_permissions {
            args.push("--allow-dangerously-skip-permissions".into());
        }
        args.push("--include-partial-messages".into());
        if session {
            push(&mut args, "--add-dir", &self.cwd.to_string_lossy());
        }
        args
    }

    /// The MCP servers the `initialize` request declares as in-process.
    #[must_use]
    pub fn sdk_mcp_servers(&self) -> Vec<&'static str> {
        if self.client_tools && self.identity != SessionIdentity::Probe {
            vec![CLIENT_TOOL_SERVER]
        } else {
            Vec::new()
        }
    }
}

fn push(args: &mut Vec<OsString>, flag: &str, value: &str) {
    args.push(flag.into());
    args.push(value.into());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(profile: &str, identity: SessionIdentity) -> QueryOptions {
        QueryOptions {
            executable: "/usr/bin/claude".into(),
            cwd: "/work".into(),
            model: "opus".into(),
            effort: Some("high".into()),
            profile: profile_options(profile).unwrap_or_else(|| unreachable!()),
            identity,
            client_tools: true,
        }
    }

    fn text(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|at| args.get(at + 1))
            .map(String::as_str)
    }

    #[test]
    fn a_workspace_session_streams_json_and_accepts_edits() {
        let args = text(&options(":workspace", SessionIdentity::New("s".into())).args());
        assert_eq!(
            &args[..5],
            [
                "--output-format",
                "stream-json",
                "--verbose",
                "--input-format",
                "stream-json"
            ]
        );
        assert_eq!(after(&args, "--permission-mode"), Some("acceptEdits"));
        assert_eq!(
            after(&args, "--setting-sources"),
            Some("user,project,local")
        );
        assert_eq!(after(&args, "--session-id"), Some("s"));
        assert_eq!(after(&args, "--effort"), Some("high"));
        assert!(args.contains(&"--permission-prompt-tool=stdio".to_owned()));
        assert!(args.contains(&"--tools=default".to_owned()));
        assert!(!args.contains(&"--allow-dangerously-skip-permissions".to_owned()));
        assert!(
            after(&args, "--mcp-config").is_some_and(|config| config.contains("\"type\":\"sdk\""))
        );
    }

    #[test]
    fn read_only_restricts_tools_settings_and_mcp_and_full_access_bypasses() {
        let args = text(&options(":read-only", SessionIdentity::Resume("s".into())).args());
        assert_eq!(after(&args, "--tools"), Some("Read,Glob,Grep,LS"));
        assert_eq!(after(&args, "--setting-sources"), Some(""));
        assert!(args.contains(&"--strict-mcp-config".to_owned()));
        assert_eq!(after(&args, "--resume"), Some("s"));
        let args = text(&options(":full-access", SessionIdentity::New("s".into())).args());
        assert_eq!(after(&args, "--permission-mode"), Some("bypassPermissions"));
        assert!(args.contains(&"--allow-dangerously-skip-permissions".to_owned()));
        assert!(profile_options(":custom").is_none());
    }

    #[test]
    fn a_probe_passes_the_sdk_probe_flags_and_no_session() {
        let probe = QueryOptions::probe("/usr/bin/claude".into(), "/work".into());
        assert_eq!(
            text(&probe.args()),
            [
                "--output-format",
                "stream-json",
                "--verbose",
                "--input-format",
                "stream-json",
                "--thinking=adaptive",
                "--thinking-display",
                "summarized",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--permission-mode",
                "default",
                "--include-partial-messages",
            ]
        );
        assert!(probe.sdk_mcp_servers().is_empty());
    }
}
