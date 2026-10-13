//! Live Claude sessions without the Agent SDK: the `claude` command line,
//! the stream-json protocol, one process, and the client tools' MCP server.

pub mod command;
pub mod mcp;
pub mod process;
pub mod protocol;

#[cfg(test)]
mod tests;
