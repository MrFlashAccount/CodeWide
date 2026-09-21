//! Transport-neutral lifecycle commands, replies, and events.
//!
//! Platform hosts map these values onto their own transport. In particular,
//! this crate knows nothing about XPC, HTTP, Unix sockets, or command-line IO.

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimePhase {
    Starting,
    Running,
    PreparingUpdate,
    Degraded { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeVersions {
    pub app: String,
    pub host: String,
    pub core: String,
    pub state_schema: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpdateStatus {
    None,
    Prepared {
        from_version: String,
        target_version: String,
    },
    Applied {
        from_version: String,
        to_version: String,
    },
    Failed {
        target_version: String,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeHealth {
    pub phase: RuntimePhase,
    pub versions: RuntimeVersions,
    pub process_id: u32,
    pub launch_count: u64,
    pub started_at_unix_ms: u64,
    pub update: UpdateStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlCommand {
    Health,
    PrepareForUpdate { target_version: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlReply {
    Health(RuntimeHealth),
    UpdatePrepared(RuntimeHealth),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlEvent {
    HealthChanged(RuntimeHealth),
}
