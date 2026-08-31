#[cfg(test)]
mod tests {
    use super::*;
    use super::legacy::{ClientFrame, parse_client_frame};

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
    fn replays_from_inside_an_output_chunk() {
        let mut replay = ReplayBuffer::default();
        replay.append(b"hello");
        replay.append(b" world");
        let chunks = replay.snapshot(3).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].start, 0);
        assert_eq!(chunks[1].start, 5);
    }
}
