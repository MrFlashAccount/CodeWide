//! LSP-style framing: a `Content-Length` header block, a blank line, then
//! exactly that many bytes of JSON. Shared by the companion client and every
//! plugin so both sides enforce the same frame cap.

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The largest frame either side accepts or writes.
pub const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
/// The largest header line accepted, so a peer cannot grow a line unbounded.
const MAX_HEADER_LINE_BYTES: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("frame transport failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed frame header")]
    MalformedHeader,
    #[error("missing Content-Length header")]
    MissingLength,
    #[error("frame exceeds {MAX_FRAME_BYTES} bytes")]
    TooLarge,
    #[error("peer closed the stream inside a frame")]
    Truncated,
}

/// Reads one frame. `Ok(None)` is a clean end of stream before any header
/// byte; a stream that ends inside a frame is [`FrameError::Truncated`].
///
/// # Errors
///
/// Returns an error for transport failures, malformed or missing headers and
/// frames above [`MAX_FRAME_BYTES`].
pub async fn read_frame<R>(reader: &mut R) -> Result<Option<Vec<u8>>, FrameError>
where
    R: AsyncBufRead + Unpin,
{
    let mut content_length = None;
    let mut first = true;
    loop {
        let mut line = Vec::new();
        let read = (&mut *reader)
            .take(u64::try_from(MAX_HEADER_LINE_BYTES).unwrap_or(u64::MAX))
            .read_until(b'\n', &mut line)
            .await?;
        if read == 0 {
            return if first {
                Ok(None)
            } else {
                Err(FrameError::Truncated)
            };
        }
        first = false;
        if !line.ends_with(b"\n") {
            return Err(FrameError::MalformedHeader);
        }
        if line == b"\r\n" || line == b"\n" {
            break;
        }
        let text = std::str::from_utf8(&line).map_err(|_| FrameError::MalformedHeader)?;
        let (name, value) = text
            .trim_end_matches(['\r', '\n'])
            .split_once(':')
            .ok_or(FrameError::MalformedHeader)?;
        if name.trim().eq_ignore_ascii_case("Content-Length") {
            let length = value
                .trim()
                .parse::<usize>()
                .map_err(|_| FrameError::MalformedHeader)?;
            content_length = Some(length);
        }
    }
    let length = content_length.ok_or(FrameError::MissingLength)?;
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    let mut payload = vec![0; length];
    reader.read_exact(&mut payload).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            FrameError::Truncated
        } else {
            FrameError::Io(error)
        }
    })?;
    Ok(Some(payload))
}

/// Writes and flushes one frame.
///
/// # Errors
///
/// Returns an error for payloads above [`MAX_FRAME_BYTES`] or transport
/// failures.
pub async fn write_frame<W>(writer: &mut W, payload: &[u8]) -> Result<(), FrameError>
where
    W: AsyncWrite + Unpin,
{
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    writer.write_all(header.as_bytes()).await?;
    writer.write_all(payload).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_frames_and_reports_clean_end() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, br#"{"a":1}"#)
            .await
            .expect("write");
        write_frame(&mut buffer, br#"{"b":2}"#)
            .await
            .expect("write");
        let mut reader = tokio::io::BufReader::new(buffer.as_slice());
        assert_eq!(
            read_frame(&mut reader).await.expect("first"),
            Some(br#"{"a":1}"#.to_vec())
        );
        assert_eq!(
            read_frame(&mut reader).await.expect("second"),
            Some(br#"{"b":2}"#.to_vec())
        );
        assert_eq!(read_frame(&mut reader).await.expect("end"), None);
    }

    #[tokio::test]
    async fn rejects_oversized_and_truncated_frames() {
        let header = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1);
        let mut reader = tokio::io::BufReader::new(header.as_bytes());
        assert!(matches!(
            read_frame(&mut reader).await,
            Err(FrameError::TooLarge)
        ));
        let mut reader = tokio::io::BufReader::new(&b"Content-Length: 10\r\n\r\n{}"[..]);
        assert!(matches!(
            read_frame(&mut reader).await,
            Err(FrameError::Truncated)
        ));
        let mut reader = tokio::io::BufReader::new(&b"X-Other: 1\r\n\r\n"[..]);
        assert!(matches!(
            read_frame(&mut reader).await,
            Err(FrameError::MissingLength)
        ));
    }
}
