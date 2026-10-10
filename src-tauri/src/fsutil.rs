//! Small file helpers shared by settings, screenshots and documents.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

/// Writes `bytes` to `path` so that a crash, a full disk or an error never leaves a half-written
/// file: the data goes to a temp file in the same folder, is flushed to disk, and only then renamed
/// over the target. On any error the temp file is removed and an existing target stays as it was.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = temp_path(path);
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    };
    write().inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

/// `.name.lg-tmp` next to the target (same folder, so the rename stays on one volume).
fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.lg-tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumengrab-fsutil-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temp_file() {
        let dir = temp_dir("new");
        let target = dir.join("a.bin");
        write_atomic(&target, b"hello").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"hello");
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.bin"], "no temp file left behind");
    }

    #[test]
    fn replaces_an_existing_file_completely() {
        let dir = temp_dir("replace");
        let target = dir.join("a.bin");
        fs::write(&target, b"a much longer old content").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn a_failed_write_keeps_the_old_file_and_cleans_up() {
        let dir = temp_dir("fail");
        let target = dir.join("a.bin");
        fs::write(&target, b"precious").unwrap();
        // The target is a directory now: the final rename must fail.
        let blocker = dir.join("blocked");
        fs::create_dir(&blocker).unwrap();
        fs::write(blocker.join("inside"), b"x").unwrap();
        assert!(write_atomic(&blocker, b"data").is_err());
        assert!(blocker.is_dir(), "the target is untouched");
        assert_eq!(fs::read(&target).unwrap(), b"precious");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".lg-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_missing_folder_is_an_error_not_a_panic() {
        let dir = temp_dir("missing");
        assert!(write_atomic(&dir.join("nope").join("a.bin"), b"x").is_err());
    }
}
