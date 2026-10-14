//! Updates (docs/adr/0008): one state machine for the whole app, so Settings, the Quick Access cards and
//! the tray menu always agree. It asks GitHub for the small `latest.json` of the newest release, downloads
//! the signed update only when the user says so, and installs it on restart. Nothing else goes online.
//!
//! Without a public key in `tauri.conf.json` the updater is not set up: the state stays `Unavailable`
//! and nothing is ever requested (a build from source, a development build).

use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::settings::{self, SettingsStore};

/// How long between two automatic checks.
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The first automatic check waits a little, so the app start is not slowed down.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailReason {
    Network,
    Signature,
    Disk,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateState {
    /// Not set up (no public key): the page hides the controls.
    Unavailable,
    /// Nothing checked yet in this session.
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        /// The release notes of the release page (Markdown).
        notes: Option<String>,
        /// `YYYY-MM-DD`.
        date: Option<String>,
    },
    Downloading {
        version: String,
        downloaded: u64,
        total: Option<u64>,
    },
    Ready {
        version: String,
    },
    Failed {
        reason: FailReason,
        message: String,
    },
}

/// What the pages get: the state and the facts around it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub state: UpdateState,
    pub current_version: String,
    /// The last check that worked (RFC 3339, UTC).
    pub last_checked: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Persisted {
    last_checked: Option<String>,
    /// A version the user chose to skip: automatic checks do not announce it again.
    skipped: Option<String>,
}

pub struct Updater {
    configured: bool,
    path: PathBuf,
    state: Mutex<UpdateState>,
    persisted: Mutex<Persisted>,
    update: Mutex<Option<Update>>,
    /// The downloaded, verified package, until the app restarts into it.
    package: Mutex<Option<Vec<u8>>>,
    download: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

/// True if the build carries a public key: only then is the updater registered at all.
pub fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// Registers the plugin when the build is set up for updates, and starts the daily check.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let configured = configured(app);
    if configured {
        app.plugin(tauri_plugin_updater::Builder::new().build())?;
    }
    let path = settings::config_dir(app)?.join("updates.json");
    let persisted: Persisted = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    app.manage(Updater {
        configured,
        path,
        state: Mutex::new(if configured {
            UpdateState::Idle
        } else {
            UpdateState::Unavailable
        }),
        persisted: Mutex::new(persisted),
        update: Mutex::new(None),
        package: Mutex::new(None),
        download: Mutex::new(None),
    });
    if configured {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio_sleep(FIRST_CHECK_AFTER).await;
            loop {
                if due(&app) {
                    check(&app, true).await;
                }
                tokio_sleep(Duration::from_secs(60 * 60)).await;
            }
        });
    }
    Ok(())
}

async fn tokio_sleep(duration: Duration) {
    // The async runtime of Tauri is tokio; a plain thread sleep inside `spawn_blocking` keeps this crate free of a direct tokio dependency.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

/// Whether the automatic check is on and the last good check is a day old (or there never was one).
fn due(app: &AppHandle) -> bool {
    if !app.state::<SettingsStore>().get().updates.auto {
        return false;
    }
    let updater = app.state::<Updater>();
    let last = updater
        .persisted
        .lock()
        .ok()
        .and_then(|p| p.last_checked.clone())
        .and_then(|t| DateTime::parse_from_rfc3339(&t).ok());
    last.is_none_or(|t| {
        Utc::now()
            .signed_duration_since(t)
            .to_std()
            .is_ok_and(|age| age >= CHECK_EVERY)
    })
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

impl Updater {
    fn save(&self) {
        if let Ok(persisted) = self.persisted.lock() {
            if let (Some(dir), Ok(json)) = (self.path.parent(), serde_json::to_vec(&*persisted)) {
                let _ = std::fs::create_dir_all(dir);
                let _ = crate::fsutil::write_atomic(&self.path, &json);
            }
        }
    }
}

pub fn info(app: &AppHandle) -> UpdateInfo {
    let updater = app.state::<Updater>();
    UpdateInfo {
        state: updater
            .state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(UpdateState::Idle),
        current_version: app.package_info().version.to_string(),
        last_checked: updater
            .persisted
            .lock()
            .ok()
            .and_then(|p| p.last_checked.clone()),
    }
}

/// Sets the state and tells every window.
fn set_state(app: &AppHandle, state: UpdateState) {
    if let Ok(mut current) = app.state::<Updater>().state.lock() {
        *current = state;
    }
    let _ = app.emit("update-state", info(app));
    crate::updates_ui::refresh_tray(app);
}

/// Maps what went wrong to the few things a person can act on.
fn classify(error: &tauri_plugin_updater::Error) -> FailReason {
    use tauri_plugin_updater::Error as E;
    match error {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => FailReason::Signature,
        E::Io(io) if io.kind() == std::io::ErrorKind::StorageFull => FailReason::Disk,
        E::Reqwest(_) | E::Network(_) | E::ReleaseNotFound => FailReason::Network,
        _ => FailReason::Other,
    }
}

fn failed(app: &AppHandle, error: &tauri_plugin_updater::Error) {
    set_state(
        app,
        UpdateState::Failed {
            reason: classify(error),
            message: error.to_string(),
        },
    );
}

fn builder(app: &AppHandle) -> tauri_plugin_updater::Result<tauri_plugin_updater::UpdaterBuilder> {
    let builder = app.updater_builder();
    // Development builds can point the check at a local server (a test of the whole update).
    #[cfg(any(debug_assertions, feature = "dev-hooks"))]
    if let Some(url) = std::env::var("LUMENGRAB_DEV_UPDATE_ENDPOINT")
        .ok()
        .and_then(|u| u.parse().ok())
    {
        return builder.endpoints(vec![url]);
    }
    Ok(builder)
}

/// Asks for the newest version. `automatic` checks stay quiet about a version the user skipped.
pub async fn check(app: &AppHandle, automatic: bool) -> UpdateInfo {
    let updater = app.state::<Updater>();
    if !updater.configured {
        return info(app);
    }
    let busy = matches!(
        updater.state.lock().map(|s| s.clone()),
        Ok(UpdateState::Checking | UpdateState::Downloading { .. } | UpdateState::Ready { .. })
    );
    if busy {
        return info(app);
    }
    set_state(app, UpdateState::Checking);
    let result = match builder(app).and_then(|b| b.build()) {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(found) => {
            if let Ok(mut p) = updater.persisted.lock() {
                p.last_checked = Some(now());
            }
            updater.save();
            match found {
                Some(update) => {
                    let skipped = updater
                        .persisted
                        .lock()
                        .ok()
                        .and_then(|p| p.skipped.clone())
                        .is_some_and(|v| v == update.version);
                    if automatic && skipped {
                        set_state(app, UpdateState::UpToDate);
                    } else {
                        let state = UpdateState::Available {
                            version: update.version.clone(),
                            notes: update.body.clone(),
                            date: update.date.map(|d| {
                                format!("{}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
                            }),
                        };
                        if let Ok(mut slot) = updater.update.lock() {
                            *slot = Some(update);
                        }
                        set_state(app, state);
                        if automatic {
                            crate::updates_ui::announce(app);
                        }
                    }
                }
                None => set_state(app, UpdateState::UpToDate),
            }
        }
        Err(e) => failed(app, &e),
    }
    info(app)
}

/// Starts the download in the background; the progress arrives as `update-state` events.
pub fn download(app: &AppHandle) -> Result<(), String> {
    let updater = app.state::<Updater>();
    let update = updater
        .update
        .lock()
        .map_err(|_| "internal error")?
        .clone()
        .ok_or("There is no update to download.")?;
    let version = update.version.clone();
    set_state(
        app,
        UpdateState::Downloading {
            version: version.clone(),
            downloaded: 0,
            total: None,
        },
    );
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut downloaded = 0u64;
        let mut last_sent = Instant::now();
        let result = update
            .download(
                |chunk, total| {
                    downloaded += chunk as u64;
                    if last_sent.elapsed() >= Duration::from_millis(150) {
                        last_sent = Instant::now();
                        set_state(
                            &handle,
                            UpdateState::Downloading {
                                version: version.clone(),
                                downloaded,
                                total,
                            },
                        );
                        crate::updates_ui::progress(&handle);
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                if let Ok(mut slot) = handle.state::<Updater>().package.lock() {
                    *slot = Some(bytes);
                }
                set_state(&handle, UpdateState::Ready { version });
                crate::updates_ui::announce(&handle);
            }
            Err(e) => {
                failed(&handle, &e);
                crate::updates_ui::announce(&handle);
            }
        }
    });
    if let Ok(mut slot) = updater.download.lock() {
        *slot = Some(task);
    }
    Ok(())
}

/// Stops a running download; the update is offered again.
pub fn cancel(app: &AppHandle) {
    let updater = app.state::<Updater>();
    if let Ok(mut slot) = updater.download.lock() {
        if let Some(task) = slot.take() {
            task.abort();
        }
    }
    let version = updater
        .update
        .lock()
        .ok()
        .and_then(|u| u.as_ref().map(|u| (u.version.clone(), u.body.clone())));
    if let Some((version, notes)) = version {
        set_state(
            app,
            UpdateState::Available {
                version,
                notes,
                date: None,
            },
        );
    }
}

/// "Skip this version": automatic checks do not announce it again.
pub fn skip(app: &AppHandle) {
    let updater = app.state::<Updater>();
    let version = updater
        .update
        .lock()
        .ok()
        .and_then(|u| u.as_ref().map(|u| u.version.clone()));
    if let (Some(version), Ok(mut p)) = (version, updater.persisted.lock()) {
        p.skipped = Some(version);
    }
    updater.save();
    set_state(app, UpdateState::UpToDate);
}

/// Installs the downloaded package and restarts. Does not return when it works.
pub fn install_and_restart(app: &AppHandle) -> Result<(), String> {
    let updater = app.state::<Updater>();
    let update = updater
        .update
        .lock()
        .map_err(|_| "internal error")?
        .clone()
        .ok_or("There is no update to install.")?;
    let bytes = updater
        .package
        .lock()
        .map_err(|_| "internal error")?
        .clone()
        .ok_or("The update has not been downloaded yet.")?;
    if let Err(e) = update.install(bytes) {
        failed(app, &e);
        return Err(e.to_string());
    }
    app.restart();
}

/// True once an update is downloaded and waits for the restart (the tray menu says "Restart to Update").
pub fn is_ready(app: &AppHandle) -> bool {
    app.try_state::<Updater>()
        .and_then(|u| {
            u.state
                .lock()
                .ok()
                .map(|s| matches!(*s, UpdateState::Ready { .. }))
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn update_state(app: AppHandle) -> UpdateInfo {
    info(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateInfo {
    check(&app, false).await
}

#[tauri::command]
pub fn update_download(app: AppHandle) -> Result<(), String> {
    download(&app)
}

#[tauri::command]
pub fn update_cancel(app: AppHandle) {
    cancel(&app);
}

#[tauri::command]
pub fn update_skip(app: AppHandle) {
    skip(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_download_is_sorted_into_what_a_person_can_act_on() {
        use tauri_plugin_updater::Error as E;
        assert_eq!(
            classify(&E::Io(std::io::Error::from(
                std::io::ErrorKind::StorageFull
            ))),
            FailReason::Disk
        );
        assert_eq!(classify(&E::Network("down".into())), FailReason::Network);
        assert_eq!(classify(&E::ReleaseNotFound), FailReason::Network);
        assert_eq!(
            classify(&E::SignatureUtf8("x".into())),
            FailReason::Signature
        );
        assert_eq!(classify(&E::UnsupportedOs), FailReason::Other);
    }

    #[test]
    fn the_state_goes_to_the_pages_in_camel_case_with_a_kind() {
        let json = serde_json::to_value(UpdateState::Downloading {
            version: "0.5.0".into(),
            downloaded: 24,
            total: Some(38),
        })
        .unwrap();
        assert_eq!(json["kind"], "downloading");
        assert_eq!(json["downloaded"], 24);
        let failed = serde_json::to_value(UpdateState::Failed {
            reason: FailReason::Signature,
            message: "bad".into(),
        })
        .unwrap();
        assert_eq!(failed["reason"], "signature");
    }

    #[test]
    fn an_old_updates_file_without_fields_still_loads() {
        let p: Persisted = serde_json::from_str("{}").unwrap();
        assert!(p.last_checked.is_none() && p.skipped.is_none());
        let p: Persisted =
            serde_json::from_str(r#"{"lastChecked":"2026-10-14T09:41:00Z","extra":1}"#).unwrap();
        assert_eq!(p.last_checked.as_deref(), Some("2026-10-14T09:41:00Z"));
    }
}
