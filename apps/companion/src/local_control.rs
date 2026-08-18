#[cfg(unix)]
mod platform {
    use std::{
        fs::Metadata,
        io,
        os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
        path::{Path, PathBuf},
    };

    use tokio::net::{UnixListener, UnixStream};

    pub(crate) struct BoundLocalControl {
        pub(crate) listener: UnixListener,
        _socket: LocalControlSocket,
    }

    struct LocalControlSocket {
        path: PathBuf,
        device: u64,
        inode: u64,
    }

    impl Drop for LocalControlSocket {
        fn drop(&mut self) {
            let Ok(metadata) = std::fs::symlink_metadata(&self.path) else {
                return;
            };
            if is_same_socket(&metadata, self.device, self.inode) {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }

    pub(crate) async fn bind(path: &Path) -> io::Result<BoundLocalControl> {
        if !path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "control endpoint must be an absolute path",
            ));
        }
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "control endpoint must have a parent directory",
            )
        })?;
        tokio::fs::create_dir_all(parent).await?;
        secure_runtime_directory(parent).await?;
        remove_stale_socket(path).await?;

        let listener = UnixListener::bind(path)?;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
        let metadata = tokio::fs::symlink_metadata(path).await?;
        let socket = LocalControlSocket {
            path: path.to_path_buf(),
            device: metadata.dev(),
            inode: metadata.ino(),
        };
        Ok(BoundLocalControl {
            listener,
            _socket: socket,
        })
    }

    pub(crate) async fn request(
        endpoint: &Path,
        method: reqwest::Method,
        path: &str,
        administrator_token: &str,
        body: Option<&str>,
    ) -> Result<(reqwest::StatusCode, String), Box<dyn std::error::Error>> {
        let client = reqwest::Client::builder()
            .unix_socket(endpoint.to_path_buf())
            .build()?;
        let mut request = client
            .request(method, format!("http://localhost{path}"))
            .bearer_auth(administrator_token);
        if let Some(body) = body {
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body.to_owned());
        }
        let response = request.send().await?;
        let status = response.status();
        Ok((status, response.text().await?))
    }

    async fn secure_runtime_directory(parent: &Path) -> io::Result<()> {
        let metadata = tokio::fs::symlink_metadata(parent).await?;
        if !metadata.file_type().is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "control endpoint parent must be a real directory",
            ));
        }
        tokio::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700)).await
    }

    async fn remove_stale_socket(path: &Path) -> io::Result<()> {
        let metadata = match tokio::fs::symlink_metadata(path).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if !metadata.file_type().is_socket() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "refusing to replace a non-socket control endpoint",
            ));
        }
        match UnixStream::connect(path).await {
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "control endpoint is already in use",
            )),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
                ) =>
            {
                tokio::fs::remove_file(path).await
            }
            Err(error) => Err(error),
        }
    }

    fn is_same_socket(metadata: &Metadata, device: u64, inode: u64) -> bool {
        metadata.file_type().is_socket() && metadata.dev() == device && metadata.ino() == inode
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[tokio::test]
        async fn socket_is_private_exclusive_and_removed_on_drop() -> io::Result<()> {
            let directory = tempfile::tempdir()?;
            let endpoint = directory.path().join("control.sock");
            let bound = bind(&endpoint).await?;

            let mode = std::fs::metadata(&endpoint)?.permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
            let Err(error) = bind(&endpoint).await else {
                panic!("second control listener unexpectedly bound");
            };
            assert_eq!(error.kind(), io::ErrorKind::AddrInUse);

            drop(bound);
            assert!(!endpoint.exists());
            Ok(())
        }

        #[tokio::test]
        async fn non_socket_endpoint_is_never_replaced() -> io::Result<()> {
            let directory = tempfile::tempdir()?;
            let endpoint = directory.path().join("control.sock");
            std::fs::write(&endpoint, b"keep me")?;

            let Err(error) = bind(&endpoint).await else {
                panic!("non-socket endpoint was unexpectedly replaced");
            };
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
            assert_eq!(std::fs::read(&endpoint)?, b"keep me");
            Ok(())
        }
    }
}

#[cfg(unix)]
pub(crate) use platform::{bind, request};

#[cfg(not(unix))]
compile_error!("local control transport requires a platform implementation");
