//! Host-owned instructions for every agent session.

/// Instructions the host hands every agent session a provider starts,
/// resumes or forks, in addition to the provider's own and the user's
/// instructions (`AgentProvider::install_session_instructions`).
///
/// The host owns the text; a provider owns only its native channel. Each
/// start of a session carries the text again, so a session that existed
/// before the text was installed receives it at its next start, and a
/// provider must not add it twice to one session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionInstructions(&'static str);

impl SessionInstructions {
    /// Wraps the host's instruction text.
    #[must_use]
    pub const fn new(text: &'static str) -> Self {
        Self(text)
    }

    /// The instruction text.
    #[must_use]
    pub const fn text(self) -> &'static str {
        self.0
    }
}
