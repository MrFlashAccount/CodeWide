//! Branded identifiers of the `codewide-agent` v1 protocol.
//!
//! Each id is a transparent newtype over its JSON representation. A value is
//! constructed only after it passed a boundary check (non-empty, bounded),
//! so internal contracts can rely on the brand without re-validating.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Longest id accepted from any boundary. Ids are opaque correlation values;
/// anything longer is a protocol violation rather than a real identifier.
pub const MAX_ID_BYTES: usize = 512;

macro_rules! branded_string_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Brands a boundary value after checking that it is a non-empty,
            /// bounded string. Returns `None` for any other value.
            #[must_use]
            pub fn parse(value: &str) -> Option<Self> {
                (!value.is_empty() && value.len() <= MAX_ID_BYTES).then(|| Self(value.to_owned()))
            }

            /// Brands a compile-time literal. Literals are reviewed values that
            /// satisfy the `parse` rule (non-empty, bounded); a debug assertion
            /// re-checks it.
            #[must_use]
            pub fn from_static(value: &'static str) -> Self {
                debug_assert!(!value.is_empty() && value.len() <= MAX_ID_BYTES);
                Self(value.to_owned())
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            #[must_use]
            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

branded_string_id!(
    /// Provider identity: `codex` or `claude` in phase 1; the set is open.
    ProviderId
);
branded_string_id!(
    /// Companion-owned thread identity shown to clients.
    AppThreadId
);
branded_string_id!(
    /// The provider's own handle for a thread; equals the `AppThreadId` in phase 1.
    ProviderThreadRef
);
branded_string_id!(
    /// Turn identity, unique within a thread.
    TurnId
);
branded_string_id!(
    /// Item identity, unique within a turn.
    ItemId
);
branded_string_id!(
    /// Client-generated message identity used to reconcile optimistic sends.
    ClientMessageId
);

/// Provider-native runtime request id exactly as the provider protocol carries it.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NativeRequestId {
    Text(String),
    Number(i64),
}

impl NativeRequestId {
    /// Converts a JSON-RPC id; only strings and integers are request ids.
    #[must_use]
    pub fn from_json(value: &serde_json::Value) -> Option<Self> {
        match value {
            serde_json::Value::String(text) if text.len() <= MAX_ID_BYTES => {
                Some(Self::Text(text.clone()))
            }
            serde_json::Value::Number(number) => number.as_i64().map(Self::Number),
            _ => None,
        }
    }

    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Text(text) => serde_json::Value::String(text.clone()),
            Self::Number(number) => serde_json::Value::from(*number),
        }
    }
}

/// Companion-side composite identity of a runtime request: two providers may
/// issue the same native id, the pair never collides.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequestId {
    pub provider: ProviderId,
    pub native_id: NativeRequestId,
}

impl ProviderThreadRef {
    /// The phase-1 provider handle: equal to the app thread id.
    #[must_use]
    pub fn same_as(app_thread_id: &AppThreadId) -> Self {
        Self(app_thread_id.0.clone())
    }
}
