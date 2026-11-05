//! Which mount a workspace path lies on, read from `/proc/self/mountinfo`
//! without touching the path itself: a hung mount must not hang the lookup.
//! A path is matched lexically against the mount points (longest component
//! prefix); a symlink into another mount resolves to the mount of its
//! spelling.

use std::{
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

/// How long a read mount table is reused before `/proc/self/mountinfo` is read again.
const MOUNT_TABLE_TTL: Duration = Duration::from_secs(5);

/// One mounted filesystem.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mount {
    pub point: PathBuf,
    /// The filesystem type, `fuse.arc` for an Arcadia mount.
    pub fs_type: String,
}

impl Mount {
    /// Whether the filesystem is served by a userspace or network daemon that
    /// can stop answering (FUSE, NFS, SMB, 9p, Ceph, AFS). Only such mounts get
    /// a circuit breaker; a slow local disk only times out.
    #[must_use]
    pub fn can_hang(&self) -> bool {
        let fs_type = self.fs_type.as_str();
        fs_type == "fuse"
            || fs_type.starts_with("fuse.")
            || fs_type == "fuseblk"
            || matches!(
                fs_type,
                "nfs" | "nfs4" | "cifs" | "smb3" | "smbfs" | "9p" | "ceph" | "glusterfs" | "afs"
            )
    }
}

/// The mount points of a `mountinfo` text, longest first.
#[must_use]
pub fn parse_mountinfo(text: &str) -> Vec<Mount> {
    let mut mounts = text
        .lines()
        .filter_map(|line| {
            let fields = line.split(' ').collect::<Vec<_>>();
            let point = fields.get(4)?;
            let separator = fields.iter().position(|field| *field == "-")?;
            let fs_type = fields.get(separator + 1)?;
            Some(Mount {
                point: PathBuf::from(unescape(point)),
                fs_type: (*fs_type).to_owned(),
            })
        })
        .collect::<Vec<_>>();
    mounts.sort_by_key(|mount| std::cmp::Reverse(mount.point.components().count()));
    mounts
}

/// `mountinfo` escapes space, tab, newline and backslash as `\ooo`.
fn unescape(field: &str) -> String {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\'
            && index + 3 < bytes.len()
            && bytes[index + 1..=index + 3].iter().all(u8::is_ascii_digit)
            && let Ok(value) = u8::from_str_radix(&field[index + 1..=index + 3], 8)
        {
            out.push(value);
            index += 4;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The mount `path` lies on: the longest mount point that is a component
/// prefix of the lexically normalized path; `None` for a relative path.
#[must_use]
pub fn mount_of<'a>(mounts: &'a [Mount], path: &Path) -> Option<&'a Mount> {
    let path = normalize(path)?;
    mounts.iter().find(|mount| path.starts_with(&mount.point))
}

/// `path` without `.` and with `..` applied, without touching the filesystem.
fn normalize(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut normal = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normal.pop();
            }
            Component::CurDir => {}
            other => normal.push(other.as_os_str()),
        }
    }
    Some(normal)
}

/// The process's mount table, reread at most every [`MOUNT_TABLE_TTL`].
pub(crate) struct MountTable {
    source: Box<dyn Fn() -> Vec<Mount> + Send + Sync>,
    cached: Mutex<Option<(Instant, Vec<Mount>)>>,
}

impl MountTable {
    pub(crate) fn system() -> Self {
        Self::with_source(|| {
            std::fs::read_to_string("/proc/self/mountinfo")
                .map(|text| parse_mountinfo(&text))
                .unwrap_or_default()
        })
    }

    pub(crate) fn with_source(source: impl Fn() -> Vec<Mount> + Send + Sync + 'static) -> Self {
        Self {
            source: Box::new(source),
            cached: Mutex::new(None),
        }
    }

    /// The mount `path` lies on, if any.
    pub(crate) fn lookup(&self, path: &Path) -> Option<Mount> {
        let mut cached = self
            .cached
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fresh = cached
            .as_ref()
            .is_some_and(|(read_at, _)| read_at.elapsed() < MOUNT_TABLE_TTL);
        if !fresh {
            *cached = Some((Instant::now(), (self.source)()));
        }
        cached
            .as_ref()
            .and_then(|(_, mounts)| mount_of(mounts, path).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOUNTINFO: &str = "\
22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw
95 22 0:52 / /home/user/arcadia rw,nosuid shared:50 - fuse.arc arc rw,user_id=1
96 22 0:53 / /home/user/arcadia-wt/task\\040one rw,nosuid shared:51 - fuse.arc arc rw
97 22 0:54 / /home/user/share rw - nfs4 server:/share rw
";

    #[test]
    fn finds_the_longest_mount_without_touching_the_path() {
        let mounts = parse_mountinfo(MOUNTINFO);
        let mount =
            |path: &str| mount_of(&mounts, Path::new(path)).map(|mount| mount.point.clone());
        assert_eq!(
            mount("/home/user/arcadia/junk/../src/a.rs"),
            Some(PathBuf::from("/home/user/arcadia"))
        );
        assert_eq!(
            mount("/home/user/arcadia-wt/task one/x"),
            Some(PathBuf::from("/home/user/arcadia-wt/task one"))
        );
        // A sibling whose name only starts with a mount point is not on it.
        assert_eq!(mount("/home/user/arcadia2/x"), Some(PathBuf::from("/")));
        assert_eq!(mount("relative/path"), None);
    }

    #[test]
    fn only_daemon_backed_filesystems_can_hang() {
        let mounts = parse_mountinfo(MOUNTINFO);
        let hangs = mounts
            .iter()
            .map(|mount| (mount.point.to_string_lossy().into_owned(), mount.can_hang()))
            .collect::<Vec<_>>();
        assert!(hangs.contains(&("/".to_owned(), false)));
        assert!(hangs.contains(&("/home/user/arcadia".to_owned(), true)));
        assert!(hangs.contains(&("/home/user/share".to_owned(), true)));
    }
}
