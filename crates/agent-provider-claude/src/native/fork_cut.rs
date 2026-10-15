//! Where a fork cuts a thread's session chain. A thread's turns can span
//! several sessions (a replacement session continues a lost one); a fork
//! copies every session before the boundary entirely and the session holding
//! the boundary through the boundary turn's last message. Pure.

use agent_core::model::ForkBoundary;

use crate::transcript::{
    json::{JsonRecord, str_of},
    reconstruct::turn_ends,
    turn_index::TurnRecord,
};

/// One session of the source chain with its stored messages (its active
/// branch, oldest first).
#[derive(Clone, Copy, Debug)]
pub struct ChainSession<'a> {
    pub session_id: &'a str,
    pub messages: &'a [&'a JsonRecord],
}

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

/// The sessions to copy, oldest first, for `boundary`; `records` is the
/// thread's turn index.
#[must_use]
pub fn fork_cut(
    chain: &[ChainSession<'_>],
    records: &[TurnRecord],
    boundary: &ForkBoundary,
) -> ForkCut {
    let (turn_id, through) = match boundary {
        ForkBoundary::All => {
            let Some((last, before)) = chain.split_last() else {
                return ForkCut::NothingBefore;
            };
            return ForkCut::Cut {
                whole: before
                    .iter()
                    .map(|session| session.session_id.to_owned())
                    .collect(),
                last: SessionCut {
                    session_id: last.session_id.to_owned(),
                    up_to_message_id: None,
                },
            };
        }
        ForkBoundary::Before { turn_id } => (turn_id, false),
        ForkBoundary::Through { turn_id } => (turn_id, true),
    };
    let messages = chain
        .iter()
        .flat_map(|session| session.messages.iter().copied())
        .collect::<Vec<_>>();
    let mut ends = turn_ends(&messages, records);
    let Some(index) = ends.iter().position(|end| end.turn_id == *turn_id) else {
        return ForkCut::UnknownTurn;
    };
    let kept = if through {
        Some(index)
    } else {
        index.checked_sub(1)
    };
    let Some(end) = kept.map(|kept| ends.swap_remove(kept)) else {
        return ForkCut::NothingBefore;
    };
    let Some(holder) = chain.iter().position(|session| {
        session
            .messages
            .iter()
            .any(|message| str_of(message, "uuid") == Some(end.last_uuid.as_str()))
    }) else {
        return ForkCut::UnknownTurn;
    };
    ForkCut::Cut {
        whole: chain[..holder]
            .iter()
            .map(|session| session.session_id.to_owned())
            .collect(),
        last: SessionCut {
            session_id: chain[holder].session_id.to_owned(),
            up_to_message_id: Some(end.last_uuid),
        },
    }
}

#[cfg(test)]
mod tests {
    use agent_core::model::TurnId;
    use serde_json::{Value, json};

    use super::*;

    fn rows(values: &[Value]) -> Vec<JsonRecord> {
        values
            .iter()
            .filter_map(|value| value.as_object().cloned())
            .collect()
    }

    fn prompt(uuid: &str, parent: Option<&str>, text: &str) -> Value {
        json!({"type": "user", "uuid": uuid, "parentUuid": parent, "timestamp": "2026-10-01T10:00:00.000Z",
            "message": {"role": "user", "content": text}})
    }

    fn answer(uuid: &str, parent: &str, text: &str) -> Value {
        json!({"type": "assistant", "uuid": uuid, "parentUuid": parent, "timestamp": "2026-10-01T10:00:01.000Z",
            "message": {"id": format!("msg_{uuid}"), "role": "assistant", "content": [{"type": "text", "text": text}]}})
    }

    fn turn(id: &str) -> TurnId {
        TurnId::parse(id).unwrap_or_else(|| TurnId::from_static("turn"))
    }

    fn cut(session: &str, whole: &[&str], up_to: Option<&str>) -> ForkCut {
        ForkCut::Cut {
            whole: whole.iter().map(|id| (*id).to_owned()).collect(),
            last: SessionCut {
                session_id: session.to_owned(),
                up_to_message_id: up_to.map(ToOwned::to_owned),
            },
        }
    }

    #[test]
    fn cuts_one_session_through_or_before_a_turn() {
        let stored = rows(&[
            prompt("p-1", None, "Fix the flaky test"),
            answer("a-1", "p-1", "Fixed."),
            prompt("p-2", Some("a-1"), "Now add a regression test"),
            answer("a-2", "p-2", "Added."),
        ]);
        let messages = stored.iter().collect::<Vec<_>>();
        let chain = [ChainSession {
            session_id: "s1",
            messages: &messages,
        }];
        let through = ForkBoundary::Through {
            turn_id: turn("p-1"),
        };
        assert_eq!(fork_cut(&chain, &[], &through), cut("s1", &[], Some("a-1")));
        let before = ForkBoundary::Before {
            turn_id: turn("p-2"),
        };
        assert_eq!(fork_cut(&chain, &[], &before), cut("s1", &[], Some("a-1")));
        assert_eq!(
            fork_cut(&chain, &[], &ForkBoundary::All),
            cut("s1", &[], None)
        );
        let first = ForkBoundary::Before {
            turn_id: turn("p-1"),
        };
        assert_eq!(fork_cut(&chain, &[], &first), ForkCut::NothingBefore);
        let gone = ForkBoundary::Through {
            turn_id: turn("gone"),
        };
        assert_eq!(fork_cut(&chain, &[], &gone), ForkCut::UnknownTurn);
        assert_eq!(
            fork_cut(&[], &[], &ForkBoundary::All),
            ForkCut::NothingBefore
        );
    }

    #[test]
    fn copies_earlier_sessions_whole_and_cuts_the_one_holding_the_turn() {
        let lost = rows(&[prompt("p-1", None, "First"), answer("a-1", "p-1", "One.")]);
        let replacement = rows(&[
            prompt("p-2", None, "Second"),
            answer("a-2", "p-2", "Two."),
            prompt("p-3", Some("a-2"), "Third"),
            answer("a-3", "p-3", "Three."),
        ]);
        let lost_messages = lost.iter().collect::<Vec<_>>();
        let replacement_messages = replacement.iter().collect::<Vec<_>>();
        let chain = [
            ChainSession {
                session_id: "lost",
                messages: &lost_messages,
            },
            ChainSession {
                session_id: "replacement",
                messages: &replacement_messages,
            },
        ];
        let through = ForkBoundary::Through {
            turn_id: turn("p-2"),
        };
        assert_eq!(
            fork_cut(&chain, &[], &through),
            cut("replacement", &["lost"], Some("a-2"))
        );
        let before = ForkBoundary::Before {
            turn_id: turn("p-2"),
        };
        assert_eq!(
            fork_cut(&chain, &[], &before),
            cut("lost", &[], Some("a-1"))
        );
        assert_eq!(
            fork_cut(&chain, &[], &ForkBoundary::All),
            cut("replacement", &["lost"], None)
        );
    }
}
