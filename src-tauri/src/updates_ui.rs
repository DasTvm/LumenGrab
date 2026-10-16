//! What the update state looks like outside Settings: the Quick Access card (here, downloading, ready,
//! failed) and the tray menu entry. The state itself lives in `updater`.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use tauri::{menu::MenuItem, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

use crate::{
    quick_access::{self, notice},
    updater::{self, UpdateState},
};

#[derive(Default)]
pub struct UpdateUi {
    /// The card that shows the update, while it is on the screen.
    card: Mutex<Option<String>>,
    /// When the running download started (for "about 10 seconds left").
    started: Mutex<Option<Instant>>,
    /// The last time the card's progress was redrawn.
    drawn: Mutex<Option<Instant>>,
    /// The tray menu entry that checks, or restarts.
    tray: Mutex<Option<MenuItem<Wry>>>,
    /// The user chose "Install and restart" and the unsaved documents are being dealt with one by one.
    pending_restart: AtomicBool,
}

const RESTART_DIALOG: &str = "update-restart";

pub fn init(app: &AppHandle) {
    use tauri::Manager as _;
    app.manage(UpdateUi::default());
}

/// "24 of 38 MB · about 10 seconds left" (the same words as the Settings page).
pub fn download_text(downloaded: u64, total: Option<u64>, elapsed: Duration) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    let size = match total {
        Some(total) => format!(
            "{:.0} of {:.0} MB",
            downloaded as f64 / MB,
            total as f64 / MB
        ),
        None => format!("{:.0} MB", downloaded as f64 / MB),
    };
    let secs = elapsed.as_secs_f64();
    let left = match total {
        Some(total) if downloaded > 0 && downloaded < total && secs >= 1.5 => {
            let seconds = ((total - downloaded) as f64 / downloaded as f64 * secs).round();
            Some(if seconds < 5.0 {
                "a few seconds left".to_owned()
            } else if seconds < 90.0 {
                format!("about {} seconds left", (seconds / 5.0).ceil() as u64 * 5)
            } else {
                format!("about {} minutes left", (seconds / 60.0).round() as u64)
            })
        }
        _ => None,
    };
    match left {
        Some(left) => format!("{size} · {left}"),
        None => size,
    }
}

/// The card for a state, or `None` for states that have none (checking, up to date).
fn notice_for(ui: &UpdateUi, state: &UpdateState) -> Option<notice::Notice> {
    match state {
        UpdateState::Available { version, .. } => Some(notice::update_available(version)),
        UpdateState::Downloading {
            version,
            downloaded,
            total,
        } => {
            let elapsed = ui
                .started
                .lock()
                .ok()
                .and_then(|s| *s)
                .map_or(Duration::ZERO, |s| s.elapsed());
            let fraction = total
                .filter(|t| *t > 0)
                .map(|t| (*downloaded as f32 / t as f32).min(1.0));
            Some(notice::update_downloading(
                version,
                download_text(*downloaded, *total, elapsed),
                fraction,
            ))
        }
        UpdateState::Ready { .. } => Some(notice::update_ready()),
        UpdateState::Failed { reason, .. } => Some(notice::update_failed(*reason)),
        _ => None,
    }
}

/// Shows the card for the current state (a new one, or the old one with new words). Call from a worker thread.
pub fn announce(app: &AppHandle) {
    sync(app, true);
}

/// Redraws the card while a download runs, but only if it is still there (the user may have closed it).
pub fn progress(app: &AppHandle) {
    let ui = app.state::<UpdateUi>();
    if let Ok(mut started) = ui.started.lock() {
        started.get_or_insert_with(Instant::now);
    }
    let due = ui
        .drawn
        .lock()
        .map(|mut d| {
            let due = d.is_none_or(|t| t.elapsed() >= Duration::from_millis(500));
            if due {
                *d = Some(Instant::now());
            }
            due
        })
        .unwrap_or(false);
    if due {
        sync(app, false);
    }
}

fn sync(app: &AppHandle, create: bool) {
    let ui = app.state::<UpdateUi>();
    let info = updater::info(app);
    let Some(notice) = notice_for(&ui, &info.state) else {
        return;
    };
    if !matches!(info.state, UpdateState::Downloading { .. }) {
        if let Ok(mut started) = ui.started.lock() {
            *started = None;
        }
    }
    let existing = ui.card.lock().ok().and_then(|c| c.clone());
    if let Some(id) = existing {
        if quick_access::replace_notice(app, &id, notice.clone()) {
            return;
        }
    }
    if create {
        let id = quick_access::notify_id(app, notice);
        if let Ok(mut card) = ui.card.lock() {
            *card = id;
        }
    }
}

/// Hands the tray entry over, so the state can change its words.
pub fn set_tray_item(app: &AppHandle, item: MenuItem<Wry>) {
    let Some(ui) = app.try_state::<UpdateUi>() else {
        return;
    };
    if let Ok(mut slot) = ui.tray.lock() {
        *slot = Some(item);
    }
    refresh_tray(app);
}

/// The tray entry says what clicking it does: look, wait, or restart.
pub fn refresh_tray(app: &AppHandle) {
    // Nothing to show before the updater exists (and nothing to fail on).
    let (Some(ui), Some(_)) = (
        app.try_state::<UpdateUi>(),
        app.try_state::<updater::Updater>(),
    ) else {
        return;
    };
    let info = updater::info(app);
    let (text, enabled, tip) = match &info.state {
        UpdateState::Ready { .. } => ("Restart to Update", true, "LumenGrab: update ready"),
        UpdateState::Downloading { .. } => (
            "Downloading Update…",
            false,
            "LumenGrab: downloading an update",
        ),
        UpdateState::Checking => ("Checking for Updates…", false, "LumenGrab"),
        UpdateState::Available { .. } => ("Update Available…", true, "LumenGrab: update available"),
        _ => ("Check for Updates…", true, "LumenGrab"),
    };
    if let Ok(slot) = ui.tray.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_text(text);
            let _ = item.set_enabled(enabled);
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// The tray entry was chosen: restart if an update is ready, otherwise open Settings > Updates and look.
pub fn tray_clicked(app: &AppHandle) {
    if updater::is_ready(app) {
        request_restart(app);
        return;
    }
    crate::tray::show_settings_page(app, "updates");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        updater::check(&app, false).await;
    });
}

/// "Install and restart" from anywhere. Documents with unsaved changes are listed first, and each one
/// asks its own "Save changes?" before the app restarts.
pub fn request_restart(app: &AppHandle) {
    if crate::document::dirty_documents(app).is_empty() {
        install_now(app);
        return;
    }
    if let Some(window) = app.get_webview_window(RESTART_DIALOG) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(
        app,
        RESTART_DIALOG,
        WebviewUrl::App("index.html?window=update-restart".into()),
    )
    .title("LumenGrab")
    .inner_size(480.0, 470.0)
    .resizable(false)
    .minimizable(false)
    .always_on_top(true)
    .center()
    .build();
    match built {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(e) => eprintln!("[lumengrab] could not open the restart dialog: {e}"),
    }
}

/// Installs the update and restarts, off the thread that asked (the install takes a moment).
fn install_now(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = updater::install_and_restart(&app) {
            eprintln!("[lumengrab] the update could not be installed: {e}");
        }
    });
}

fn close_dialog(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(RESTART_DIALOG) {
        let _ = window.destroy();
    }
}

/// A document of the restart went away: if it was the last unsaved one, the update goes ahead.
pub fn after_document_closed(app: &AppHandle) {
    let Some(ui) = app.try_state::<UpdateUi>() else {
        return;
    };
    if ui.pending_restart.load(Ordering::SeqCst) && crate::document::dirty_documents(app).is_empty()
    {
        ui.pending_restart.store(false, Ordering::SeqCst);
        install_now(app);
    }
}

/// The user said Cancel to a "Save changes?" of the restart: nothing is installed.
pub fn cancel_pending_restart(app: &AppHandle) {
    if let Some(ui) = app.try_state::<UpdateUi>() {
        ui.pending_restart.store(false, Ordering::SeqCst);
    }
}

/// The unsaved documents the dialog lists.
#[tauri::command]
pub async fn update_restart_documents(app: AppHandle) -> Vec<crate::document::DirtyDocument> {
    crate::document::dirty_documents(&app)
}

/// "Install and restart" in the dialog: every unsaved document asks "Save changes?" in its own window;
/// when the last one is dealt with the update is installed.
#[tauri::command]
pub async fn update_restart_confirm(app: AppHandle) -> Result<(), String> {
    close_dialog(&app);
    let dirty = crate::document::dirty_documents(&app);
    if dirty.is_empty() {
        install_now(&app);
        return Ok(());
    }
    app.state::<UpdateUi>()
        .pending_restart
        .store(true, Ordering::SeqCst);
    for document in dirty {
        if let Some(window) = app.get_webview_window(&document.label) {
            let _ = window.show();
            let _ = window.set_focus();
            // A document with unsaved changes does not close: it asks the page, which asks the user.
            let _ = window.close();
        }
    }
    Ok(())
}

/// "Later" in the dialog.
#[tauri::command]
pub async fn update_restart_dismiss(app: AppHandle) {
    close_dialog(&app);
    cancel_pending_restart(&app);
}

/// "Restart now" in Settings or on a card: like the tray entry.
#[tauri::command]
pub async fn update_restart(app: AppHandle) -> Result<(), String> {
    request_restart(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    #[test]
    fn the_download_line_names_megabytes_and_the_time_left() {
        let secs = Duration::from_secs;
        assert_eq!(
            download_text(24 * MB, Some(38 * MB), secs(1)),
            "24 of 38 MB"
        );
        assert_eq!(
            download_text(10 * MB, Some(40 * MB), secs(3)),
            "10 of 40 MB · about 10 seconds left"
        );
        assert_eq!(
            download_text(39 * MB, Some(40 * MB), secs(10)),
            "39 of 40 MB · a few seconds left"
        );
        assert_eq!(
            download_text(MB, Some(400 * MB), secs(10)),
            "1 of 400 MB · about 67 minutes left"
        );
        assert_eq!(download_text(5 * MB, None, secs(10)), "5 MB");
    }

    #[test]
    fn only_the_states_with_something_to_say_have_a_card() {
        let ui = UpdateUi::default();
        assert!(notice_for(&ui, &UpdateState::Checking).is_none());
        assert!(notice_for(&ui, &UpdateState::UpToDate).is_none());
        let ready = notice_for(
            &ui,
            &UpdateState::Ready {
                version: "0.5.0".into(),
            },
        )
        .unwrap();
        assert_eq!(ready.title, "A new version of LumenGrab is ready");
        assert_eq!(ready.actions.iter().filter(|a| a.primary).count(), 1);
        let here = notice_for(
            &ui,
            &UpdateState::Available {
                version: "0.5.0".into(),
                notes: None,
                date: None,
            },
        )
        .unwrap();
        assert_eq!(here.title, "LumenGrab 0.5.0 is here");
        assert_eq!(here.actions.len(), 3);
    }
}
