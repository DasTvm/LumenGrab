//! The history of captures (M6, docs/adr/0010-history.md).
//!
//! Every new capture is kept as a **copy** in `<app data>/history/`: `<id>.png` (the picture as it was
//! saved), `<id>.thumb.png` (the small preview the window shows) and, when the automatic look was put on,
//! `<id>.orig.png` (the capture before the look, which Edit opens). `index.json` lists them. Files the
//! user saved themselves (in the screenshots folder, with Save as…) are never touched or removed.
//!
//! The page never names a path: everything goes by entry id, and an id is only ever turned into a file
//! name here, after it was checked against the index.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    capture::{encode, CaptureMode},
    platform,
    settings::{HistoryKeep, SettingsStore},
};

const INDEX_VERSION: u32 = 1;
const INDEX_FILE: &str = "index.json";
/// More than this is never kept, whatever the retention says (a safety net, not a setting).
const MAX_ENTRIES: usize = 5000;
/// A deletion that can still be undone waits this long before the files go to the Trash.
const UNDO_WINDOW: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    /// The name shown in the window, e.g. `LumenGrab 2026-10-25 at 14.02.11.png`.
    name: String,
    /// Milliseconds since 1970.
    captured_at: i64,
    width: u32,
    height: u32,
    bytes: u64,
    /// `area`, `window`, `fullscreen` or `allinone`.
    source: String,
    /// The capture before the automatic look is kept next to the picture.
    #[serde(default)]
    has_original: bool,
    /// Where the user's own saved copy lives (shown with "Show in folder" while it still exists).
    #[serde(default)]
    saved_path: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Index {
    version: u32,
    entries: Vec<Entry>,
}

impl Default for Index {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            entries: Vec::new(),
        }
    }
}

/// What the window shows for one capture.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInfo {
    id: String,
    name: String,
    captured_at: i64,
    width: u32,
    height: u32,
    bytes: u64,
    source: String,
    /// The picture file is gone (moved or deleted outside the app).
    missing: bool,
    pinned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryList {
    entries: Vec<EntryInfo>,
    /// Recording is switched off in the settings; what is listed was kept earlier.
    off: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    count: usize,
    bytes: u64,
}

struct State {
    /// `Err` holds why the index could not be read; every command then says so until it is reset.
    index: Result<Index, String>,
    /// Entries waiting for the Trash (hidden, files still in place), with the moment they were hidden.
    pending: Vec<(Vec<String>, SystemTime)>,
}

pub struct History {
    dir: PathBuf,
    state: Mutex<State>,
}

/// `<app data>/history`. Dev builds can point it elsewhere (`LUMENGRAB_DEV_HISTORY_DIR`).
fn dir_of(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if let Ok(dir) = std::env::var("LUMENGRAB_DEV_HISTORY_DIR") {
        return Ok(dir.into());
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join("history"))
        .map_err(|e| format!("The app data folder could not be found: {e}"))
}

fn read_index(dir: &Path) -> Result<Index, String> {
    let path = dir.join(INDEX_FILE);
    match fs::read(&path) {
        Ok(bytes) => {
            let index: Index = serde_json::from_slice(&bytes)
                .map_err(|_| "the history file is damaged".to_string())?;
            if index.version > INDEX_VERSION {
                return Err("the history was written by a newer version of LumenGrab".into());
            }
            Ok(index)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn write_index(dir: &Path, index: &Index) -> Result<(), String> {
    let json = serde_json::to_vec(index).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    crate::fsutil::write_atomic(&dir.join(INDEX_FILE), &json).map_err(|e| e.to_string())
}

fn picture(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.png"))
}
fn thumb_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.thumb.png"))
}
fn original_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.orig.png"))
}

fn remove_files(dir: &Path, id: &str) {
    for path in [
        picture(dir, id),
        thumb_file(dir, id),
        original_file(dir, id),
    ] {
        let _ = fs::remove_file(path);
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// A new id: the capture time plus a counter, so two captures in one millisecond differ.
fn new_id(existing: &[Entry]) -> String {
    let base = now_ms();
    (0u32..)
        .map(|n| format!("{base:x}{n:02x}"))
        .find(|id| existing.iter().all(|e| &e.id != id))
        .expect("an unused id exists")
}

/// How long a capture is kept; `None` = forever.
fn keep_for(keep: HistoryKeep) -> Option<Duration> {
    const DAY: u64 = 24 * 60 * 60;
    match keep {
        HistoryKeep::Week => Some(Duration::from_secs(7 * DAY)),
        HistoryKeep::Month => Some(Duration::from_secs(30 * DAY)),
        HistoryKeep::Quarter => Some(Duration::from_secs(90 * DAY)),
        HistoryKeep::Year => Some(Duration::from_secs(365 * DAY)),
        HistoryKeep::Forever => None,
    }
}

/// Entries that are older than `keep` (by capture time) or beyond the safety limit, oldest last.
fn expired(entries: &[Entry], now_ms: i64, keep: Option<Duration>) -> Vec<String> {
    let cutoff = keep.map(|k| now_ms - k.as_millis() as i64);
    entries
        .iter()
        .enumerate()
        .filter(|(i, e)| *i >= MAX_ENTRIES || cutoff.is_some_and(|c| e.captured_at < c))
        .map(|(_, e)| e.id.clone())
        .collect()
}

impl History {
    fn new(dir: PathBuf) -> Self {
        let index = read_index(&dir);
        Self {
            dir,
            state: Mutex::new(State {
                index,
                pending: Vec::new(),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("history state")
    }

    /// Runs `change` on the entries and writes the index. The change only counts if the write works.
    fn edit<T>(&self, change: impl FnOnce(&mut Vec<Entry>) -> T) -> Result<T, String> {
        let mut state = self.lock();
        let index = state
            .index
            .as_mut()
            .map_err(|e| format!("The history can't be read: {e}."))?;
        let mut next = Index {
            version: INDEX_VERSION,
            entries: index.entries.clone(),
        };
        let out = change(&mut next.entries);
        write_index(&self.dir, &next)?;
        *index = next;
        Ok(out)
    }

    fn entry(&self, id: &str) -> Result<Entry, String> {
        let state = self.lock();
        let index = state
            .index
            .as_ref()
            .map_err(|e| format!("The history can't be read: {e}."))?;
        index
            .entries
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or_else(|| "This capture is no longer in the history.".to_string())
    }

    /// Entries hidden because they wait for the Trash.
    fn hidden(state: &State) -> HashSet<&str> {
        state
            .pending
            .iter()
            .flat_map(|(ids, _)| ids.iter().map(String::as_str))
            .collect()
    }
}

// ---- recording ----------------------------------------------------------------------------------

/// What `record` needs to keep a capture.
pub struct Recorded<'a> {
    /// The picture as saved (its file is copied), or `None` when `png` is the picture.
    pub saved: Option<&'a Path>,
    /// The picture itself, when it was never saved as a file (a text capture that keeps its picture).
    pub png: Option<&'a [u8]>,
    /// The name shown when there is no saved file.
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    /// The small preview the Quick Access card shows (a PNG).
    pub thumb: &'a [u8],
    pub source: CaptureMode,
    /// The capture before the automatic look, if there was one.
    pub original: Option<&'a [u8]>,
}

/// Keeps a copy of a new capture. Does nothing while history is off. Errors are only logged: a capture
/// must never fail because the history could not keep it.
pub fn record(app: &AppHandle, new: &Recorded) {
    if !app.state::<SettingsStore>().get().history.enabled {
        return;
    }
    if let Err(e) = record_inner(app, new) {
        eprintln!("[lumengrab] the history could not keep this capture: {e}");
    }
}

fn record_inner(app: &AppHandle, new: &Recorded) -> Result<(), String> {
    let history = app.state::<History>();
    let dir = &history.dir;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let id = {
        let state = history.lock();
        let index = state.index.as_ref().map_err(|e| e.clone())?;
        new_id(&index.entries)
    };
    let bytes = match (new.saved, new.png) {
        (Some(saved), _) => {
            fs::copy(saved, picture(dir, &id)).map_err(|e| format!("{}: {e}", saved.display()))?
        }
        (None, Some(png)) => {
            crate::fsutil::write_atomic(&picture(dir, &id), png)
                .map_err(|e| format!("{}: {e}", picture(dir, &id).display()))?;
            png.len() as u64
        }
        (None, None) => return Err("There is no picture to keep.".into()),
    };
    let write = |path: PathBuf, data: &[u8]| {
        crate::fsutil::write_atomic(&path, data).map_err(|e| format!("{}: {e}", path.display()))
    };
    let result = (|| {
        write(thumb_file(dir, &id), new.thumb)?;
        if let Some(original) = new.original {
            write(original_file(dir, &id), original)?;
        }
        let name = new
            .saved
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .or_else(|| new.name.clone())
            .unwrap_or_else(|| format!("{id}.png"));
        let entry = Entry {
            id: id.clone(),
            name,
            captured_at: now_ms(),
            width: new.width,
            height: new.height,
            bytes,
            source: source_name(new.source).into(),
            has_original: new.original.is_some(),
            saved_path: new.saved.map(Path::to_path_buf),
        };
        history.edit(|entries| entries.insert(0, entry))
    })();
    if result.is_err() {
        remove_files(dir, &id);
    }
    result?;
    sweep(app);
    Ok(())
}

fn source_name(mode: CaptureMode) -> &'static str {
    match mode {
        CaptureMode::Area => "area",
        CaptureMode::Window => "window",
        CaptureMode::Fullscreen => "fullscreen",
        CaptureMode::AllInOne => "allinone",
        // A text capture that keeps its picture is an area.
        CaptureMode::Text => "area",
    }
}

/// Removes what is older than the retention says (and anything beyond the safety limit). Only the
/// history's own copies go; nothing the user saved is ever touched.
pub fn sweep(app: &AppHandle) {
    let history = app.state::<History>();
    let keep = keep_for(app.state::<SettingsStore>().get().history.keep);
    let gone = {
        let state = history.lock();
        match &state.index {
            Ok(index) => expired(&index.entries, now_ms(), keep),
            Err(_) => return,
        }
    };
    if gone.is_empty() {
        return;
    }
    let drop: HashSet<&str> = gone.iter().map(String::as_str).collect();
    if history
        .edit(|entries| entries.retain(|e| !drop.contains(e.id.as_str())))
        .is_ok()
    {
        for id in &gone {
            remove_files(&history.dir, id);
        }
    }
}

pub fn init(app: &AppHandle) {
    match dir_of(app) {
        Ok(dir) => {
            app.manage(History::new(dir));
            sweep(app);
            recover_pending(app);
        }
        Err(e) => {
            eprintln!("[lumengrab] history unavailable: {e}");
            app.manage(History {
                dir: PathBuf::new(),
                state: Mutex::new(State {
                    index: Err(e),
                    pending: Vec::new(),
                }),
            });
        }
    }
}

/// Files that no index entry owns (a crash between a copy and the index write) are removed.
fn recover_pending(app: &AppHandle) {
    let history = app.state::<History>();
    let known: HashSet<String> = {
        let state = history.lock();
        match &state.index {
            Ok(index) => index.entries.iter().map(|e| e.id.clone()).collect(),
            Err(_) => return,
        }
    };
    let Ok(listing) = fs::read_dir(&history.dir) else {
        return;
    };
    for file in listing.flatten() {
        let name = file.file_name().to_string_lossy().into_owned();
        if name == INDEX_FILE || name.starts_with('.') {
            continue;
        }
        let id = name.split('.').next().unwrap_or_default();
        if !known.contains(id) {
            let _ = fs::remove_file(file.path());
        }
    }
}

// ---- reading ------------------------------------------------------------------------------------

/// The thumbnail PNG of an entry (served as `lgcapture://localhost/history-<id>`).
pub fn thumb(app: &AppHandle, id: &str) -> Option<Vec<u8>> {
    let history = app.state::<History>();
    let entry = history.entry(id).ok()?;
    fs::read(thumb_file(&history.dir, &entry.id)).ok()
}

/// The picture file of an entry (never handed to the page, only used natively).
pub fn picture_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let history = app.state::<History>();
    let entry = history.entry(id)?;
    let path = picture(&history.dir, &entry.id);
    if path.is_file() {
        Ok(path)
    } else {
        Err("This capture is no longer available: its file was moved or deleted.".into())
    }
}

/// Whether `path` is the kept capture-before-the-look of a history entry (Edit then puts the look back on as a presentation).
pub fn is_original(app: &AppHandle, path: &Path) -> bool {
    let Some(history) = app.try_state::<History>() else {
        return false;
    };
    path.parent() == Some(history.dir.as_path())
        && path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().ends_with(".orig.png"))
}

/// The newest capture that is listed (the target of "Pin last capture").
pub fn newest(app: &AppHandle) -> Option<String> {
    let history = app.state::<History>();
    let state = history.lock();
    let hidden = History::hidden(&state);
    let index = state.index.as_ref().ok()?;
    index
        .entries
        .iter()
        .find(|e| !hidden.contains(e.id.as_str()) && picture(&history.dir, &e.id).is_file())
        .map(|e| e.id.clone())
}

/// The picture file of an entry with the name it is shown under.
pub fn picture_with_name(app: &AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    let entry = app.state::<History>().entry(id)?;
    Ok((picture_path(app, id)?, entry.name))
}

/// The entry that was made from a saved file (a Quick Access card knows the file, not the entry).
pub fn id_for_saved_path(app: &AppHandle, path: &Path) -> Option<String> {
    let history = app.state::<History>();
    let state = history.lock();
    let index = state.index.as_ref().ok()?;
    index
        .entries
        .iter()
        .find(|e| e.saved_path.as_deref() == Some(path))
        .map(|e| e.id.clone())
}

/// The file Edit opens: the capture before the look if there is one, else the picture.
pub fn edit_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let history = app.state::<History>();
    let entry = history.entry(id)?;
    let original = original_file(&history.dir, &entry.id);
    if entry.has_original && original.is_file() {
        return Ok(original);
    }
    picture_path(app, id)
}

#[tauri::command]
pub fn history_list(app: AppHandle) -> Result<HistoryList, String> {
    finish_expired_trash(&app);
    let history = app.state::<History>();
    let state = history.lock();
    let index = state
        .index
        .as_ref()
        .map_err(|e| format!("The history can't be read: {e}."))?;
    let hidden = History::hidden(&state);
    let pins = crate::pin::pinned_entries(&app);
    let entries = index
        .entries
        .iter()
        .filter(|e| !hidden.contains(e.id.as_str()))
        .map(|e| EntryInfo {
            id: e.id.clone(),
            name: e.name.clone(),
            captured_at: e.captured_at,
            width: e.width,
            height: e.height,
            bytes: e.bytes,
            source: e.source.clone(),
            missing: !picture(&history.dir, &e.id).is_file(),
            pinned: pins.contains(&e.id),
        })
        .collect();
    Ok(HistoryList {
        entries,
        off: !app.state::<SettingsStore>().get().history.enabled,
    })
}

#[tauri::command]
pub fn history_usage(app: AppHandle) -> Result<Usage, String> {
    let history = app.state::<History>();
    let state = history.lock();
    let index = state
        .index
        .as_ref()
        .map_err(|e| format!("The history can't be read: {e}."))?;
    let bytes = index
        .entries
        .iter()
        .map(|e| {
            [
                picture(&history.dir, &e.id),
                thumb_file(&history.dir, &e.id),
                original_file(&history.dir, &e.id),
            ]
            .iter()
            .filter_map(|p| fs::metadata(p).ok())
            .map(|m| m.len())
            .sum::<u64>()
        })
        .sum();
    Ok(Usage {
        count: index.entries.len(),
        bytes,
    })
}

// ---- actions ------------------------------------------------------------------------------------

#[tauri::command]
pub async fn history_copy(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let path = picture_path(&app, &id)?;
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let frame = encode::decode_png(&bytes).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn history_edit(app: AppHandle, id: String) -> Result<(), String> {
    let path = edit_path(&app, &id)?;
    crate::document::open_capture(&app, &path).map(|_| ())
}

/// Shows the user's own saved copy in Finder / Explorer while it exists, else the history's copy.
#[tauri::command]
pub fn history_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let history = app.state::<History>();
    let entry = history.entry(&id)?;
    let own = entry.saved_path.filter(|p| p.is_file());
    let path = match own {
        Some(path) => path,
        None => picture_path(&app, &id)?,
    };
    platform::reveal_file(&path);
    Ok(())
}

/// The picture of an entry as raw binary (the window builds a `.lumengrab` or a pin from it).
#[tauri::command]
pub async fn history_file_bytes(
    app: AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let path = picture_path(&app, &id)?;
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// "Save as…": asks where, copies the picture there. `None` if the user cancelled.
#[tauri::command]
pub async fn history_save_copy(app: AppHandle, id: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let history = app.state::<History>();
    let entry = history.entry(&id)?;
    let source = picture_path(&app, &id)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(entry.name)
        .add_filter("PNG image", &["png"]);
    if let Some(dir) = entry.saved_path.as_deref().and_then(Path::parent) {
        if dir.is_dir() {
            dialog = dialog.set_directory(dir);
        }
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let target = chosen.into_path().map_err(|e| e.to_string())?;
    fs::copy(&source, &target).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(Some(crate::quick_access::short_folder(&target)))
}

/// "Remove from History": the history's copy goes for good; the user's own file stays.
#[tauri::command]
pub fn history_remove(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let history = app.state::<History>();
    let drop: HashSet<&str> = ids.iter().map(String::as_str).collect();
    history.edit(|entries| entries.retain(|e| !drop.contains(e.id.as_str())))?;
    for id in &ids {
        if id.chars().all(|c| c.is_ascii_alphanumeric()) {
            remove_files(&history.dir, id);
        }
    }
    Ok(())
}

/// "Move to Trash": the entries disappear from the window at once; their files go to the Trash after
/// a short while unless `history_undo_trash` comes first.
#[tauri::command]
pub fn history_trash(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let history = app.state::<History>();
    {
        let mut state = history.lock();
        let known: Vec<String> = match &state.index {
            Ok(index) => ids
                .iter()
                .filter(|id| index.entries.iter().any(|e| &e.id == *id))
                .cloned()
                .collect(),
            Err(e) => return Err(format!("The history can't be read: {e}.")),
        };
        state.pending.push((known, SystemTime::now()));
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UNDO_WINDOW + Duration::from_millis(200));
        finish_expired_trash(&handle);
    });
    Ok(())
}

#[tauri::command]
pub fn history_undo_trash(app: AppHandle, ids: Vec<String>) {
    let history = app.state::<History>();
    let mut state = history.lock();
    state
        .pending
        .retain(|(pending, _)| !pending.iter().any(|id| ids.contains(id)));
}

/// Moves the files of every deletion whose undo window is over to the Trash and drops the entries.
fn finish_expired_trash(app: &AppHandle) {
    let history = app.state::<History>();
    let due: Vec<String> = {
        let mut state = history.lock();
        let now = SystemTime::now();
        let mut due = Vec::new();
        state.pending.retain(|(ids, since)| {
            let over = now
                .duration_since(*since)
                .is_ok_and(|age| age >= UNDO_WINDOW);
            if over {
                due.extend(ids.iter().cloned());
            }
            !over
        });
        due
    };
    if due.is_empty() {
        return;
    }
    let drop: HashSet<&str> = due.iter().map(String::as_str).collect();
    let _ = history.edit(|entries| entries.retain(|e| !drop.contains(e.id.as_str())));
    for id in &due {
        let files = [picture(&history.dir, id), original_file(&history.dir, id)];
        let existing: Vec<PathBuf> = files.into_iter().filter(|p| p.is_file()).collect();
        if !existing.is_empty() {
            if let Err(e) = trash::delete_all(&existing) {
                eprintln!("[lumengrab] the history could not use the Trash: {e}");
                for file in existing {
                    let _ = fs::remove_file(file);
                }
            }
        }
        let _ = fs::remove_file(thumb_file(&history.dir, id));
    }
}

/// Settings > History > Clear history…: everything the history keeps goes, the user's files stay.
#[tauri::command]
pub fn history_clear(app: AppHandle) -> Result<(), String> {
    let history = app.state::<History>();
    let ids: Vec<String> = {
        let state = history.lock();
        match &state.index {
            Ok(index) => index.entries.iter().map(|e| e.id.clone()).collect(),
            Err(_) => Vec::new(),
        }
    };
    history.edit(|entries| entries.clear())?;
    history.lock().pending.clear();
    for id in &ids {
        remove_files(&history.dir, id);
    }
    Ok(())
}

/// The index could not be read: start over with an empty one (the old pictures are removed, since
/// nothing lists them any more).
#[tauri::command]
pub fn history_reset(app: AppHandle) -> Result<(), String> {
    let history = app.state::<History>();
    if let Ok(listing) = fs::read_dir(&history.dir) {
        for file in listing.flatten() {
            let _ = fs::remove_file(file.path());
        }
    }
    write_index(&history.dir, &Index::default())?;
    history.lock().index = Ok(Index::default());
    Ok(())
}

/// Re-reads the index from disk (the window's "Try again").
#[tauri::command]
pub fn history_reload(app: AppHandle) -> Result<(), String> {
    let history = app.state::<History>();
    let index = read_index(&history.dir);
    let result = index.as_ref().map(|_| ()).map_err(|e| e.clone());
    history.lock().index = index;
    result.map_err(|e| format!("The history can't be read: {e}."))
}

#[tauri::command]
pub fn history_open_folder(app: AppHandle) -> Result<(), String> {
    let history = app.state::<History>();
    fs::create_dir_all(&history.dir).map_err(|e| format!("{}: {e}", history.dir.display()))?;
    platform::open_folder(&history.dir);
    Ok(())
}

// ---- the window ---------------------------------------------------------------------------------

const WINDOW_LABEL: &str = "history";

/// "Open History" of the settings page and the cards (async: a command that builds a window must
/// not run on the main thread on Windows).
#[tauri::command]
pub async fn history_show(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || show(&handle));
}

/// Opens the History window, or focuses it if it already exists.
pub fn show(app: &AppHandle) {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("index.html?window=history".into()),
    )
    .title("LumenGrab History")
    .inner_size(1100.0, 720.0)
    .min_inner_size(820.0, 520.0)
    .center()
    .build();
    match result {
        Ok(window) => {
            platform::update_dock_presence(app, None);
            let _ = window.set_focus();
        }
        Err(err) => eprintln!("failed to open the history window: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, age_days: i64, now: i64) -> Entry {
        Entry {
            id: id.into(),
            name: format!("{id}.png"),
            captured_at: now - age_days * 24 * 60 * 60 * 1000,
            width: 10,
            height: 10,
            bytes: 1,
            source: "area".into(),
            has_original: false,
            saved_path: None,
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumengrab-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn retention_removes_only_what_is_older_than_the_choice() {
        let now = 1_000_000_000_000;
        let entries = vec![
            entry("new", 1, now),
            entry("mid", 20, now),
            entry("old", 40, now),
        ];
        assert_eq!(
            expired(&entries, now, keep_for(HistoryKeep::Month)),
            ["old"]
        );
        assert_eq!(
            expired(&entries, now, keep_for(HistoryKeep::Week)),
            ["mid", "old"]
        );
        assert!(expired(&entries, now, keep_for(HistoryKeep::Forever)).is_empty());
    }

    #[test]
    fn the_safety_limit_applies_even_when_the_choice_is_forever() {
        let now = 1_000_000_000_000;
        let entries: Vec<Entry> = (0..MAX_ENTRIES + 3)
            .map(|i| entry(&format!("e{i}"), 0, now))
            .collect();
        let gone = expired(&entries, now, None);
        assert_eq!(gone.len(), 3);
        assert_eq!(gone[0], format!("e{MAX_ENTRIES}"));
    }

    #[test]
    fn an_index_round_trips_and_a_missing_one_is_empty() {
        let dir = temp_dir("roundtrip");
        assert!(read_index(&dir).unwrap().entries.is_empty());
        let index = Index {
            version: INDEX_VERSION,
            entries: vec![entry("a", 0, 5)],
        };
        write_index(&dir, &index).unwrap();
        assert_eq!(read_index(&dir).unwrap().entries, index.entries);
    }

    #[test]
    fn a_damaged_or_newer_index_is_an_error_not_an_empty_list() {
        let dir = temp_dir("damaged");
        fs::write(dir.join(INDEX_FILE), b"{ not json").unwrap();
        assert!(read_index(&dir).unwrap_err().contains("damaged"));
        fs::write(dir.join(INDEX_FILE), br#"{"version":99,"entries":[]}"#).unwrap();
        assert!(read_index(&dir).unwrap_err().contains("newer"));
    }

    #[test]
    fn ids_do_not_repeat_within_one_millisecond() {
        let mut entries: Vec<Entry> = Vec::new();
        for _ in 0..50 {
            let id = new_id(&entries);
            assert!(entries.iter().all(|e| e.id != id));
            entries.push(entry(&id, 0, 0));
        }
    }

    #[test]
    fn removing_files_leaves_other_entries_alone() {
        let dir = temp_dir("files");
        for id in ["a", "b"] {
            fs::write(picture(&dir, id), b"x").unwrap();
            fs::write(thumb_file(&dir, id), b"x").unwrap();
        }
        remove_files(&dir, "a");
        assert!(!picture(&dir, "a").exists() && !thumb_file(&dir, "a").exists());
        assert!(picture(&dir, "b").exists() && thumb_file(&dir, "b").exists());
    }
}
