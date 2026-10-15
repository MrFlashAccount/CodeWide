//! Naming of the companion's client tools inside Claude: they are served as
//! one MCP server named [`CLIENT_TOOL_SERVER`], so Claude calls them as
//! `mcp__codewide__<tool>`. Their items are neutral `toolCall`s with the bare
//! tool name and no namespace, the same shape on every provider. Pure.

/// Name of the MCP server that carries the client tools.
pub const CLIENT_TOOL_SERVER: &str = "codewide";

const QUALIFIED_PREFIX: &str = "mcp__codewide__";

/// The name Claude calls a client tool by.
#[must_use]
pub fn qualified_client_tool_name(tool: &str) -> String {
    format!("{QUALIFIED_PREFIX}{tool}")
}

/// The bare client tool name of a Claude tool name, or `None` for other tools.
#[must_use]
pub fn client_tool_of(tool_name: &str) -> Option<&str> {
    tool_name
        .strip_prefix(QUALIFIED_PREFIX)
        .filter(|bare| !bare.is_empty())
}
