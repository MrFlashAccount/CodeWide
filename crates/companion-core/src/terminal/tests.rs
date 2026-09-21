#[cfg(test)]
mod tests {
    use super::legacy::{ClientFrame, parse_client_frame};
    use super::*;

    #[test]
    fn parses_input_and_resize_frames() {
        assert!(matches!(
            parse_client_frame(&[0, b'a']),
            Ok(ClientFrame::Input(b"a"))
        ));
        let Ok(ClientFrame::Resize(size)) = parse_client_frame(&[1, 0, 120, 0, 40]) else {
            panic!("resize frame was not parsed");
        };
        assert_eq!((size.cols, size.rows), (120, 40));
    }

    #[test]
    fn rejects_invalid_frames_and_sizes() {
        assert!(parse_client_frame(&[]).is_err());
        assert!(parse_client_frame(&[1, 0, 1, 0, 24]).is_err());
        assert!(parse_client_frame(&[2, 0]).is_err());
    }

    #[test]
    fn terminal_preflight_allocates_a_pty() {
        preflight().unwrap_or_else(|error| panic!("{error}"));
    }

    #[test]
    fn validates_stable_terminal_session_ids() {
        assert!(valid_session_id(
            "terminal-12345678-1234-1234-1234-123456789abc"
        ));
        assert!(!valid_session_id("terminal-not-a-uuid"));
        assert!(!valid_session_id(
            "terminal-12345678-1234-1234-1234-123456789abz"
        ));
    }

    #[test]
    fn preserves_known_terminal_exit_code_and_signal() {
        assert_eq!(
            TerminalExit::from_status(Some(ExitStatus::with_exit_code(7))),
            TerminalExit {
                exit_code: Some(7),
                signal: None,
            }
        );
        assert_eq!(
            TerminalExit::from_status(Some(ExitStatus::with_signal("SIGTERM"))),
            TerminalExit {
                exit_code: Some(1),
                signal: Some("SIGTERM".into()),
            }
        );
    }

    #[test]
    fn replays_from_inside_an_output_chunk() {
        let quota = Arc::new(ReplayQuota::new(1024, 1024));
        let mut replay = ReplayBuffer::new("owner".into(), quota, 1024);
        replay
            .append(b"hello")
            .unwrap_or_else(|error| panic!("first append: {error:?}"));
        replay
            .append(b" world")
            .unwrap_or_else(|error| panic!("second append: {error:?}"));
        let Some(chunk) = replay
            .read_chunk(3)
            .unwrap_or_else(|error| panic!("replay: {error:?}"))
        else {
            panic!("replay chunk is missing");
        };
        assert_eq!(chunk.start, 3);
        assert_eq!(chunk.bytes.as_ref(), b"lo world");
    }

    #[test]
    fn replays_exact_bytes_after_spilling_beyond_thirty_two_mebibytes() {
        let old_window = 32 * 1024 * 1024;
        let quota = Arc::new(ReplayQuota::new(
            u64::try_from(old_window + 1024).unwrap_or_else(|error| panic!("owner quota: {error}")),
            u64::try_from(old_window + 1024)
                .unwrap_or_else(|error| panic!("global quota: {error}")),
        ));
        let mut replay = ReplayBuffer::new("owner".into(), quota, 1024);
        let filler = vec![b'x'; OUTPUT_CHUNK_BYTES];
        let mut expected = Vec::with_capacity(old_window + 16);
        while expected.len() < old_window + 1 {
            let count = (old_window + 1 - expected.len()).min(filler.len());
            replay
                .append(&filler[..count])
                .unwrap_or_else(|error| panic!("filler append: {error:?}"));
            expected.extend_from_slice(&filler[..count]);
        }
        for split in [
            b"\x1b".as_slice(),
            b"[".as_slice(),
            b"38;2;1".as_slice(),
            b";2;3m".as_slice(),
        ] {
            replay
                .append(split)
                .unwrap_or_else(|error| panic!("escape fragment append: {error:?}"));
            expected.extend_from_slice(split);
        }

        assert!(matches!(replay.storage, ReplayStorage::Disk(_)));
        let mut actual = Vec::with_capacity(expected.len());
        let mut offset = 0_u64;
        while let Some(chunk) = replay
            .read_chunk(offset)
            .unwrap_or_else(|error| panic!("replay read: {error:?}"))
        {
            offset += u64::try_from(chunk.bytes.len())
                .unwrap_or_else(|error| panic!("chunk size: {error}"));
            actual.extend_from_slice(&chunk.bytes);
        }
        assert_eq!(actual, expected);
    }

    #[test]
    fn rejects_future_replay_cursor_without_rebasing() {
        let quota = Arc::new(ReplayQuota::new(1024, 1024));
        let mut replay = ReplayBuffer::new("owner".into(), quota, 1024);
        replay
            .append(b"exact")
            .unwrap_or_else(|error| panic!("append: {error:?}"));
        assert!(matches!(
            replay.read_chunk(u64::MAX),
            Err(ReplayReadError::Unavailable)
        ));
    }

    #[test]
    fn enforces_owner_and_global_replay_quotas_and_releases_usage() {
        let quota = Arc::new(ReplayQuota::new(6, 10));
        let mut first = ReplayBuffer::new("owner-a".into(), Arc::clone(&quota), 1);
        let mut same_owner = ReplayBuffer::new("owner-a".into(), Arc::clone(&quota), 1);
        let mut other_owner = ReplayBuffer::new("owner-b".into(), Arc::clone(&quota), 1);
        first
            .append(b"123456")
            .unwrap_or_else(|error| panic!("owner allocation: {error:?}"));
        let Err(owner_failure) = same_owner.append(b"x") else {
            panic!("owner quota was not enforced");
        };
        assert_eq!(owner_failure, ReplayFailure::OwnerQuotaExceeded);
        other_owner
            .append(b"1234")
            .unwrap_or_else(|error| panic!("global allocation: {error:?}"));
        let Err(global_failure) = other_owner.append(b"x") else {
            panic!("global quota was not enforced");
        };
        assert_eq!(global_failure, ReplayFailure::GlobalQuotaExceeded);
        drop(first);
        same_owner
            .append(b"123456")
            .unwrap_or_else(|error| panic!("released owner quota: {error:?}"));
    }

    #[cfg(unix)]
    #[test]
    fn disk_spool_is_private_and_removed_on_clear() {
        use std::os::unix::fs::PermissionsExt;

        let quota = Arc::new(ReplayQuota::new(1024, 1024));
        let mut replay = ReplayBuffer::new("owner".into(), Arc::clone(&quota), 1);
        replay
            .append(b"secret terminal output")
            .unwrap_or_else(|error| panic!("append: {error:?}"));
        let ReplayStorage::Disk(file) = &replay.storage else {
            panic!("replay did not spill to disk");
        };
        let path = file.path().to_path_buf();
        let mode = std::fs::metadata(&path)
            .unwrap_or_else(|error| panic!("spool metadata: {error}"))
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        replay.clear();

        assert!(!path.exists());
        let usage = lock(&quota.usage);
        assert_eq!(usage.global, 0);
        assert!(usage.owners.is_empty());
    }

    #[tokio::test]
    async fn generation_replacement_cleans_the_previous_spool() {
        let registry = TerminalRegistry::new(2);
        let mut query = TerminalQuery {
            cwd: Some(env::temp_dir().to_string_lossy().into_owned()),
            thread_id: Some("thread-a".into()),
            cols: Some(80),
            rows: Some(24),
            session_id: Some("terminal-00000000-0000-0000-0000-000000000002".into()),
            offset: Some(0),
            create: Some(true),
        };
        let previous = registry
            .attach_or_create_v2("device-a", 7, &query, || TerminalSession::spawn(&query))
            .unwrap_or_else(|error| panic!("initial terminal: {error}"));
        let spool_path = {
            let mut replay = lock(&previous.replay);
            replay.memory_limit = 1;
            replay
                .append(b"private output")
                .unwrap_or_else(|error| panic!("spool append: {error:?}"));
            let ReplayStorage::Disk(file) = &replay.storage else {
                panic!("replay did not spill to disk");
            };
            file.path().to_path_buf()
        };
        assert!(spool_path.exists());

        query.offset = Some(0);
        let replacement = registry
            .attach_or_create_v2("device-a", 8, &query, || TerminalSession::spawn(&query))
            .unwrap_or_else(|error| panic!("replacement terminal: {error}"));

        assert!(!spool_path.exists());
        assert_eq!(replacement.id, previous.id);
        assert_eq!(replacement.generation, Some(8));
        previous.revoke_and_wait().await;
        replacement.revoke_and_wait().await;
    }

    #[tokio::test]
    async fn reclaims_only_a_detached_v2_terminal_for_the_same_device() {
        let registry = TerminalRegistry::new(1);
        let query = TerminalQuery {
            cwd: Some(env::temp_dir().to_string_lossy().into_owned()),
            thread_id: Some("thread-a".into()),
            cols: Some(80),
            rows: Some(24),
            session_id: Some("terminal-12345678-1234-1234-1234-123456789abc".into()),
            offset: Some(0),
            create: Some(true),
        };
        let terminal = registry
            .attach_or_create_v2("device-a", 7, &query, || TerminalSession::spawn(&query))
            .unwrap_or_else(|error| panic!("{error}"));
        drop(terminal);

        assert!(!registry.reclaim_oldest_detached_v2("device-b"));
        assert!(registry.reclaim_oldest_detached_v2("device-a"));
        for _ in 0..100 {
            if registry.inner.slots.available_permits() == 1 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("revoked terminal did not release its process slot");
    }
}
