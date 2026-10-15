//! The id Claude gives a background task: the `backgroundTaskId` of a
//! background `Bash` call's result and the `task-id` of its report (for
//! example `bd3cb8oli`; a sub-agent's is its agent id). Claude names the
//! task's output file after it, so a valid id is also a safe file name.
//! Pure.

/// The longest id accepted. Claude's ids are a few characters long.
const MAX_TASK_ID_LEN: usize = 64;

/// A background task id: 1 to 64 ASCII letters and digits, so it can never
/// name another directory or file than `<task id>.output`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct BackgroundTaskId(String);

impl BackgroundTaskId {
    /// The id when `raw` has Claude's id shape; `None` otherwise.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        ((1..=MAX_TASK_ID_LEN).contains(&raw.len())
            && raw.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        .then(|| Self(raw.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }

    /// The name of the task's output file: `<task id>.output`.
    #[must_use]
    pub fn output_file_name(&self) -> String {
        format!("{}.output", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_short_alphanumeric_ids_are_task_ids() {
        for valid in ["bd3cb8oli", "a0000000000000001", "B1"] {
            assert_eq!(
                BackgroundTaskId::parse(valid).map(|id| id.output_file_name()),
                Some(format!("{valid}.output"))
            );
        }
        for invalid in [
            "",
            "../x",
            "..",
            "b1/../../etc/passwd",
            "b1.output",
            "/tmp/b1",
            "b 1",
            "b1\0",
            "bé1",
            &"b".repeat(MAX_TASK_ID_LEN + 1),
        ] {
            assert_eq!(BackgroundTaskId::parse(invalid), None, "{invalid:?}");
        }
    }
}
