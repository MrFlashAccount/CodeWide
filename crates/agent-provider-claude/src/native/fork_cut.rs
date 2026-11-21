//! What a fork cuts from a thread's session chain. A thread's turns can
//! span several sessions (a replacement session continues a lost one); a
//! fork copies every session before the boundary entirely and the session
//! holding the boundary through the boundary turn's last message. The index
//! decides the cut (`index::history::IndexedHistory::fork_cut`).

/// The last session a fork copies: entirely (`up_to_message_id: None`) or
/// through that message.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionCut {
    pub session_id: String,
    pub up_to_message_id: Option<String>,
}

/// What a fork at a boundary copies.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ForkCut {
    /// Copy `whole` entirely, oldest first, then `last` as it says.
    Cut {
        whole: Vec<String>,
        last: SessionCut,
    },
    /// The boundary keeps no turn (before the first one), or the chain is
    /// empty.
    NothingBefore,
    /// No turn of the chain has the boundary's id.
    UnknownTurn,
}
