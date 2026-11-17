use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

pub struct NoteStore {
    directory: PathBuf,
}

impl NoteStore {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }
    fn file(&self, key: &str) -> Result<PathBuf, String> {
        if key.is_empty() {
            return Err("Invalid note key".into());
        }
        Ok(self
            .directory
            .join(format!("{:x}.txt", Sha256::digest(key.as_bytes()))))
    }
    pub fn read(&mut self, key: &str, legacy: Option<&str>) -> Result<Option<String>, String> {
        match fs::read_to_string(self.file(key)?) {
            Ok(text) => Ok(Some(text)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Some(text) = legacy {
                    self.write(key, text)?;
                }
                Ok(legacy.map(str::to_owned))
            }
            Err(error) => Err(error.to_string()),
        }
    }
    pub fn write(&mut self, key: &str, text: &str) -> Result<(), String> {
        let file = self.file(key)?;
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let temporary = file.with_extension("txt.tmp");
        fs::write(&temporary, text).map_err(|e| e.to_string())?;
        fs::rename(temporary, file).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn store() -> NoteStore {
        let name = format!(
            "dsh-tauri-notes-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        NoteStore::new(std::env::temp_dir().join(name))
    }

    #[test]
    fn unicode_empty_and_restart_preserve_notes() {
        let mut original = store();
        assert_eq!(original.read("main", None).unwrap(), None);
        original.write("main", "第一行\n第二页😀").unwrap();
        let mut restarted = NoteStore::new(original.directory.clone());
        assert_eq!(
            restarted.read("main", None).unwrap().as_deref(),
            Some("第一行\n第二页😀")
        );
        restarted.write("main", "").unwrap();
        assert_eq!(
            restarted
                .read("main", Some("obsolete draft"))
                .unwrap()
                .as_deref(),
            Some("")
        );
    }

    #[test]
    fn keys_cannot_escape_directory_and_do_not_collide() {
        let mut notes = store();
        let path = notes.file("../../outside").unwrap();
        assert_eq!(path.parent(), Some(notes.directory.as_path()));
        notes.write("../../outside", "one").unwrap();
        notes.write("main", "two").unwrap();
        assert_eq!(
            notes.read("../../outside", None).unwrap().as_deref(),
            Some("one")
        );
        assert!(notes.write("", "invalid").is_err());
    }

    #[test]
    fn failed_write_is_reported() {
        let mut notes = store();
        fs::write(&notes.directory, "not a directory").unwrap();
        assert!(notes.write("main", "must not be acknowledged").is_err());
    }
}
