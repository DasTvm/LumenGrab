//! Quick Access: the small card that appears in a screen corner after a capture (copy, save as,
//! show in folder, close). Native side: the stack of cards, their windows and the file actions.
//! All looks and behaviour of the card itself (timer, tooltips, states) are TypeScript
//! (`?window=quick`); the native side only places the windows, serves the thumbnails and does what
//! a web page cannot (clipboard, files, reveal).
//!
//! One transparent window per card (`qa-1` .. `qa-3`), created on first use and then reused, like
//! the capture overlays (see `capture/overlay.rs`). Locking rules: `Inner` is only held for a
//! moment, never while a window is being created or an OS call runs; window creation is serialised
//! by `creating`, and the whole "show a new card" sequence by `show_lock`; both are only taken by
//! worker threads (creating a window waits for the main thread, and sync commands run on it).

pub mod commands;
pub mod layout;
pub mod notice;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use self::{
    layout::{CardBox, Pad, Placed, WorkArea},
    notice::{Handler, Notice, NoticePayload},
};
use crate::{
    capture::CaptureMode,
    platform,
    settings::{Corner, QuickAccessStyle, SettingsStore},
};

/// At most this many cards are visible; a newer capture closes the oldest.
const MAX_CARDS: usize = 3;
const LABELS: [&str; MAX_CARDS] = ["qa-1", "qa-2", "qa-3"];
const COMPACT_WIDTH: f64 = 340.0;
const LARGE_WIDTH: f64 = 380.0;
/// Notice cards (design: "Toast").
const NOTICE_WIDTH: f64 = 480.0;
/// The first-start hint (design: "Welcome Hint").
const WELCOME_WIDTH: f64 = 380.0;
/// Heights used until the page reports its real one.
const COMPACT_HEIGHT: f64 = 74.0;
const LARGE_HEIGHT: f64 = 315.0;

/// A finished capture, ready to be shown.
pub struct NewCard {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub source: CaptureMode,
    pub bytes: u64,
    /// PNG, at most 728 px wide.
    pub thumb: Vec<u8>,
}

struct Card {
    id: String,
    label: &'static str,
    path: PathBuf,
    width: u32,
    height: u32,
    source: CaptureMode,
    bytes: u64,
    thumb: Arc<Vec<u8>>,
    /// The style chosen in the settings when the capture happened. Only the newest card shows it;
    /// older ones shrink to compact.
    style: QuickAccessStyle,
    auto_close_secs: u8,
    css_height: f64,
    extra_top: f64,
    extra_bottom: f64,
    shown: bool,
    /// "Delete" was pressed: the file goes to the Trash when the card closes, unless Undo came first.
    pending_delete: bool,
    /// A notice card (an error or warning with buttons) instead of a screenshot; the screenshot
    /// fields are empty then.
    notice: Option<Notice>,
}

impl Card {
    fn css_width(&self) -> f64 {
        if let Some(notice) = &self.notice {
            return if notice.tone == notice::Tone::Info {
                WELCOME_WIDTH
            } else {
                NOTICE_WIDTH
            };
        }
        match self.style {
            QuickAccessStyle::Compact => COMPACT_WIDTH,
            QuickAccessStyle::Large => LARGE_WIDTH,
        }
    }
}

/// The monitor and corner the stack lives on; fixed while at least one card is open.
#[derive(Clone, Copy)]
struct Area {
    work: WorkArea,
    scale: f64,
    corner: Corner,
}

#[derive(Default)]
struct Inner {
    /// Newest first (index 0 is in the corner).
    cards: Vec<Card>,
    area: Option<Area>,
}

impl Inner {
    /// Adds a card in front. Returns the oldest one if the stack was full.
    fn push(&mut self, card: Card) -> Option<Card> {
        let evicted = (self.cards.len() >= MAX_CARDS).then(|| self.cards.remove(MAX_CARDS - 1));
        self.cards.insert(0, card);
        evicted
    }

    fn remove(&mut self, id: &str) -> Option<Card> {
        let at = self.cards.iter().position(|c| c.id == id)?;
        let card = self.cards.remove(at);
        if self.cards.is_empty() {
            self.area = None;
        }
        Some(card)
    }

    /// A window label no open card uses.
    fn free_label(&self) -> Option<&'static str> {
        LABELS
            .into_iter()
            .find(|l| !self.cards.iter().any(|c| c.label == *l))
    }

    fn boxes(&self) -> Vec<CardBox> {
        self.cards
            .iter()
            .map(|c| CardBox {
                width: c.css_width(),
                height: c.css_height,
                extra_top: c.extra_top,
                extra_bottom: c.extra_bottom,
            })
            .collect()
    }
}

#[derive(Default)]
pub struct QuickAccess {
    inner: Mutex<Inner>,
    creating: Mutex<()>,
    show_lock: Mutex<()>,
    counter: std::sync::atomic::AtomicU64,
}

/// What the card's web page needs to draw itself (camelCase for TypeScript).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPayload {
    id: String,
    /// The style this card is drawn in right now (older cards of a large stack are compact).
    style: QuickAccessStyle,
    width: f64,
    auto_close_secs: u8,
    /// Path for the `lgcapture` scheme (`qa-<id>`).
    thumb_key: String,
    pixel_width: u32,
    pixel_height: u32,
    file_name: String,
    /// Folder shown to the user, e.g. `Pictures/LumenGrab`.
    folder: String,
    /// `Area`, `Window` or `Fullscreen`.
    source: &'static str,
    bytes: u64,
    pad: Pad,
    /// Present on notice cards: what to say and which buttons to draw.
    #[serde(skip_serializing_if = "Option::is_none")]
    notice: Option<NoticePayload>,
    /// `bottom` if the stack sits in a bottom corner: there is no room below a card, so hints that
    /// belong "beside" the card go above it.
    edge: &'static str,
}

/// `label` names the window the update is for: a JS listener hears events addressed to any
/// window, so each page has to filter for its own.
#[derive(Clone, Serialize)]
struct Update {
    label: &'static str,
    card: Option<CardPayload>,
}

fn source_name(source: CaptureMode) -> &'static str {
    match source {
        CaptureMode::Area => "Area",
        CaptureMode::Window => "Window",
        CaptureMode::Fullscreen => "Fullscreen",
    }
}

/// `Pictures/LumenGrab` from `/Users/x/Pictures/LumenGrab/file.png`: the last two folders.
pub(crate) fn short_folder(path: &std::path::Path) -> String {
    let parts: Vec<String> = path
        .parent()
        .into_iter()
        .flat_map(|p| p.components())
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    parts[parts.len().saturating_sub(2)..].join("/")
}

fn payload(card: &Card, index: usize, placed: &Placed, corner: Corner) -> CardPayload {
    CardPayload {
        id: card.id.clone(),
        style: if index == 0 {
            card.style
        } else {
            QuickAccessStyle::Compact
        },
        width: card.css_width(),
        auto_close_secs: if card.notice.is_some() {
            0 // notices wait until they are dealt with
        } else {
            card.auto_close_secs
        },
        thumb_key: format!("qa-{}", card.id),
        pixel_width: card.width,
        pixel_height: card.height,
        file_name: card
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        folder: short_folder(&card.path),
        source: source_name(card.source),
        bytes: card.bytes,
        pad: placed.pad,
        notice: card.notice.as_ref().map(Notice::payload),
        edge: if matches!(corner, Corner::BottomLeft | Corner::BottomRight) {
            "bottom"
        } else {
            "top"
        },
    }
}

fn card_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

/// Creates the window of one card, hidden. Call from a worker thread only.
fn ensure_window(app: &AppHandle, label: &'static str) -> tauri::Result<WebviewWindow> {
    let qa = app.state::<QuickAccess>();
    let _creating = qa.creating.lock().expect("quick access creation lock");
    if let Some(window) = card_window(app, label) {
        return Ok(window);
    }
    let builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?window=quick&slot={label}").into()),
    )
    .title("LumenGrab Quick Access")
    .decorations(false)
    .resizable(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    // Never take the keyboard focus from the app the user is working in.
    .focused(false)
    .accept_first_mouse(true)
    .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT);
    #[cfg(target_os = "windows")]
    let builder = builder.focusable(false);
    let window = builder.build()?;
    platform::configure_overlay(&window);
    Ok(window)
}

/// Builds the first card window right after startup, so the first capture is as quick as later ones.
pub fn warm_up(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(900));
        if let Err(e) = ensure_window(&app, LABELS[0]) {
            eprintln!("[lumengrab] could not prepare the quick access window: {e}");
        }
    });
}

/// Work area and scale of the monitor under the cursor (the one the user is looking at).
fn monitor_under_cursor(app: &AppHandle) -> Option<(WorkArea, f64)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((
        WorkArea {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        monitor.scale_factor(),
    ))
}

/// Moves and resizes every card window to its place and tells each page how it looks now.
fn relayout(app: &AppHandle) {
    let qa = app.state::<QuickAccess>();
    let updates: Vec<(&'static str, Placed, CardPayload, bool)> = {
        let inner = qa.inner.lock().expect("quick access state");
        let Some(area) = inner.area else { return };
        let placed = layout::stack(area.corner, area.work, area.scale, &inner.boxes());
        inner
            .cards
            .iter()
            .zip(&placed)
            .enumerate()
            .map(|(i, (card, p))| (card.label, *p, payload(card, i, p, area.corner), card.shown))
            .collect()
    };
    for (label, placed, payload, _) in updates {
        #[cfg(any(debug_assertions, feature = "dev-hooks"))]
        eprintln!(
            "[lumengrab:dev] qa {label} card {}: window {}x{} at ({}, {}), pad {:?}",
            payload.id, placed.width, placed.height, placed.x, placed.y, placed.pad
        );
        if let Some(window) = card_window(app, label) {
            let _ = window.set_size(PhysicalSize::new(placed.width, placed.height));
            let _ = window.set_position(PhysicalPosition::new(placed.x, placed.y));
        }
        let _ = app.emit_to(
            label,
            "quick-access",
            Update {
                label,
                card: Some(payload),
            },
        );
    }
}

fn hide(app: &AppHandle, label: &str) {
    if let Some(window) = card_window(app, label) {
        let _ = window.hide();
    }
    if let Some(label) = LABELS.into_iter().find(|l| *l == label) {
        let _ = app.emit_to(label, "quick-access", Update { label, card: None });
    }
}

/// Puts a new card into the stack (and its window into place). `make` builds the card from its
/// window label and id. Returns `false` if the window could not be made.
fn add_card(
    app: &AppHandle,
    corner: Corner,
    make: impl FnOnce(&'static str, String) -> Card,
) -> bool {
    let qa = app.state::<QuickAccess>();
    let _serial = qa.show_lock.lock().expect("quick access show lock");

    // Make room: the oldest card goes when the stack is full.
    let (label, evicted) = {
        let mut inner = qa.inner.lock().expect("quick access state");
        let evicted = (inner.cards.len() >= MAX_CARDS).then(|| inner.cards.remove(MAX_CARDS - 1));
        (inner.free_label(), evicted)
    };
    if let Some(old) = evicted {
        hide(app, old.label);
        trash_if_deleted(app, &old);
    }
    let Some(label) = label else {
        return false;
    };
    if let Err(e) = ensure_window(app, label) {
        eprintln!("[lumengrab] could not create the quick access window: {e}");
        return false;
    }

    let id = (qa
        .counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1)
    .to_string();
    {
        let mut inner = qa.inner.lock().expect("quick access state");
        if inner.area.is_none() {
            let Some((work, scale)) = monitor_under_cursor(app) else {
                return false;
            };
            inner.area = Some(Area {
                work,
                scale,
                corner,
            });
        }
        inner.push(make(label, id));
    }
    relayout(app);
    true
}

/// Shows a card for a freshly saved capture. Returns `false` if Quick Access is switched off or the
/// window could not be made (the caller then falls back to the plain "Saved" hint).
pub fn show(app: &AppHandle, new: NewCard) -> bool {
    let settings = app.state::<SettingsStore>().get().quick_access;
    if !settings.enabled {
        return false;
    }
    add_card(app, settings.corner, |label, id| Card {
        id,
        label,
        path: new.path,
        width: new.width,
        height: new.height,
        source: new.source,
        bytes: new.bytes,
        thumb: Arc::new(new.thumb),
        style: settings.style,
        auto_close_secs: settings.auto_close_secs,
        css_height: match settings.style {
            QuickAccessStyle::Compact => COMPACT_HEIGHT,
            QuickAccessStyle::Large => LARGE_HEIGHT,
        },
        extra_top: 0.0,
        extra_bottom: 0.0,
        shown: false,
        pending_delete: false,
        notice: None,
    })
}

/// Shows an error or warning card in the same corner (also when Quick Access is switched off: a
/// problem must not go unnoticed). Call from a worker thread, never from the main thread.
pub fn notify(app: &AppHandle, notice: Notice) -> bool {
    let corner = app.state::<SettingsStore>().get().quick_access.corner;
    add_card(app, corner, |label, id| Card {
        id,
        label,
        path: PathBuf::new(),
        width: 0,
        height: 0,
        source: CaptureMode::Area,
        bytes: 0,
        thumb: Arc::new(Vec::new()),
        style: QuickAccessStyle::Compact,
        auto_close_secs: 0,
        css_height: 150.0,
        extra_top: 0.0,
        extra_bottom: 0.0,
        shown: false,
        pending_delete: false,
        notice: Some(notice),
    })
}

/// The first-start hint (design: "Windows - First start hint"), once. It is remembered as soon as it
/// is shown, so a crash or a kill does not make it come back. `force` (dev builds) shows it anyway.
/// Call from a worker thread.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // only Windows asks for it; dev builds force it
pub fn show_intro(app: &AppHandle, force: bool) {
    let store = app.state::<SettingsStore>();
    if store.get().seen_intro && !force {
        return;
    }
    if notify(app, notice::welcome()) && !force {
        if let Err(e) = store.update(|s| s.seen_intro = true) {
            eprintln!("[lumengrab] could not remember the first-start hint: {e}");
        }
    }
}

/// What button `index` of a notice card does.
pub fn notice_handler(app: &AppHandle, id: &str, index: usize) -> Option<Handler> {
    let qa = app.state::<QuickAccess>();
    let inner = qa.inner.lock().expect("quick access state");
    inner
        .cards
        .iter()
        .find(|c| c.id == id)?
        .notice
        .as_ref()?
        .actions
        .get(index)
        .map(|a| a.handler.clone())
}

/// The page measured itself: apply its height (and tooltip room), restack, and show the window the
/// first time (it stays hidden until the thumbnail is loaded and measured, so it never flashes).
pub fn resize(app: &AppHandle, id: &str, height: f64, extra_top: f64, extra_bottom: f64) {
    // A hidden page measures 0: that is not a size.
    if !height.is_finite() || height < 1.0 {
        return;
    }
    let qa = app.state::<QuickAccess>();
    let reveal = {
        let mut inner = qa.inner.lock().expect("quick access state");
        let Some(card) = inner.cards.iter_mut().find(|c| c.id == id) else {
            return;
        };
        let (height, extra_top, extra_bottom) = (
            height.clamp(40.0, 600.0),
            extra_top.clamp(0.0, 120.0),
            extra_bottom.clamp(0.0, 120.0),
        );
        if card.shown
            && card.css_height == height
            && card.extra_top == extra_top
            && card.extra_bottom == extra_bottom
        {
            return; // nothing changed: do not restack and re-send everything
        }
        card.css_height = height;
        card.extra_top = extra_top;
        card.extra_bottom = extra_bottom;
        let first = !card.shown;
        card.shown = true;
        first.then_some(card.label)
    };
    relayout(app);
    if let Some(label) = reveal {
        if let Some(window) = card_window(app, label) {
            let _ = window.show();
        }
    }
}

/// Closes one card. Everything above it moves down to close the gap.
pub fn close(app: &AppHandle, id: &str) {
    let qa = app.state::<QuickAccess>();
    let removed = qa.inner.lock().expect("quick access state").remove(id);
    if let Some(card) = removed {
        hide(app, card.label);
        relayout(app);
        trash_if_deleted(app, &card);
    }
}

/// The file of a card that was deleted (and not undone) goes to the Trash / Recycle Bin. Off the
/// calling thread: the OS call can take a moment and the caller may be the main thread.
fn trash_if_deleted(app: &AppHandle, card: &Card) {
    if !card.pending_delete {
        return;
    }
    let (app, path) = (app.clone(), card.path.clone());
    std::thread::spawn(move || {
        if let Err(e) = trash::delete(&path) {
            notify(&app, notice::trash_failed(&e.to_string(), path));
        }
    });
}

/// "Delete" (`true`) or "Undo" (`false`). Nothing is deleted yet: that happens when the card closes.
pub fn set_pending_delete(app: &AppHandle, id: &str, pending: bool) -> bool {
    let qa = app.state::<QuickAccess>();
    let mut inner = qa.inner.lock().expect("quick access state");
    match inner
        .cards
        .iter_mut()
        .find(|c| c.id == id && c.notice.is_none())
    {
        Some(card) => {
            card.pending_delete = pending;
            true
        }
        None => false,
    }
}

pub fn card_for_label(app: &AppHandle, label: &str) -> Option<CardPayload> {
    let qa = app.state::<QuickAccess>();
    let inner = qa.inner.lock().expect("quick access state");
    let area = inner.area?;
    let placed = layout::stack(area.corner, area.work, area.scale, &inner.boxes());
    inner
        .cards
        .iter()
        .zip(&placed)
        .enumerate()
        .find(|(_, (c, _))| c.label == label)
        .map(|(i, (c, p))| payload(c, i, p, area.corner))
}

pub fn thumb(app: &AppHandle, id: &str) -> Option<Arc<Vec<u8>>> {
    let qa = app.state::<QuickAccess>();
    let inner = qa.inner.lock().expect("quick access state");
    inner
        .cards
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.thumb.clone())
}

/// The small picture that follows the pointer during a drag: the thumbnail scaled down to 132 px.
pub fn drag_image(app: &AppHandle, id: &str) -> Option<Vec<u8>> {
    let thumb = thumb(app, id)?;
    let frame = crate::capture::encode::decode_png(&thumb).ok()?;
    let small = crate::capture::pixels::downscale(&frame, 132);
    crate::capture::encode::encode_png(&small, crate::capture::encode::Profile::Fast).ok()
}

pub fn file_of(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let qa = app.state::<QuickAccess>();
    let inner = qa.inner.lock().expect("quick access state");
    inner
        .cards
        .iter()
        .find(|c| c.id == id && c.notice.is_none())
        .map(|c| c.path.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, label: &'static str) -> Card {
        Card {
            id: id.into(),
            label,
            path: PathBuf::from("/Users/x/Pictures/LumenGrab/a.png"),
            width: 10,
            height: 10,
            source: CaptureMode::Area,
            bytes: 1,
            thumb: Arc::new(vec![]),
            style: QuickAccessStyle::Compact,
            auto_close_secs: 5,
            css_height: 74.0,
            extra_top: 0.0,
            extra_bottom: 0.0,
            shown: false,
            pending_delete: false,
            notice: None,
        }
    }

    #[test]
    fn the_newest_card_is_first_and_a_fourth_one_evicts_the_oldest() {
        let mut inner = Inner::default();
        assert!(inner.push(card("1", "qa-1")).is_none());
        assert!(inner.push(card("2", "qa-2")).is_none());
        assert!(inner.push(card("3", "qa-3")).is_none());
        assert_eq!(
            inner
                .cards
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            ["3", "2", "1"]
        );
        let evicted = inner.push(card("4", "qa-1")).expect("full stack evicts");
        assert_eq!(evicted.id, "1", "the oldest goes");
        assert_eq!(
            inner
                .cards
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            ["4", "3", "2"]
        );
    }

    #[test]
    fn a_closed_cards_window_is_free_again() {
        let mut inner = Inner::default();
        inner.push(card("1", "qa-1"));
        inner.push(card("2", "qa-2"));
        assert_eq!(inner.free_label(), Some("qa-3"));
        inner.remove("1");
        assert_eq!(inner.free_label(), Some("qa-1"));
        inner.push(card("3", "qa-1"));
        inner.push(card("4", "qa-3"));
        assert_eq!(inner.free_label(), None);
    }

    #[test]
    fn closing_the_last_card_forgets_the_monitor() {
        let mut inner = Inner {
            area: Some(Area {
                work: WorkArea {
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                },
                scale: 1.0,
                corner: Corner::TopLeft,
            }),
            ..Inner::default()
        };
        inner.push(card("1", "qa-1"));
        inner.push(card("2", "qa-2"));
        inner.remove("1");
        assert!(inner.area.is_some(), "still a card open");
        inner.remove("2");
        assert!(
            inner.area.is_none(),
            "next stack may start on another monitor"
        );
        assert!(inner.remove("nope").is_none());
    }

    #[test]
    fn card_width_follows_the_configured_style() {
        let mut c = card("1", "qa-1");
        assert_eq!(c.css_width(), 340.0);
        c.style = QuickAccessStyle::Large;
        assert_eq!(c.css_width(), 380.0);
    }

    #[test]
    fn the_folder_is_shown_as_its_last_two_parts() {
        assert_eq!(
            short_folder(std::path::Path::new("/Users/x/Pictures/LumenGrab/a.png")),
            "Pictures/LumenGrab"
        );
        assert_eq!(short_folder(std::path::Path::new("/a.png")), "");
        assert_eq!(
            short_folder(std::path::Path::new("/Pictures/a.png")),
            "Pictures"
        );
    }
}
