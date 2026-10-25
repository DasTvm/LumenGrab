//! Pinned captures (M6, docs/adr/0011-pins.md): a borderless picture that floats above every other
//! window, to keep a reference in sight. One window per pin (`pin-1`, `pin-2`, ...), at most eight.
//!
//! The picture is held in memory as PNG and served to the window as `lgcapture://localhost/pin-<n>`.
//! Everything a pin does goes through commands that act on **the window they are called from**, so a
//! page can only ever change its own pin, and none of them takes a path.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{capture::encode, history, platform, quick_access};

pub const PREFIX: &str = "pin-";
const MAX_PINS: usize = 8;
/// A pin is never smaller than this (logical pixels), so its buttons stay reachable.
const MIN_EDGE: f64 = 140.0;
/// The sizes the mouse wheel steps through.
const STEPS: [u32; 16] = [
    25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400,
];
/// A new pin shows at most this share of the screen it appears on.
const MAX_SHARE: f64 = 0.8;
/// How far each new pin sits from the one before (logical pixels).
const CASCADE: f64 = 28.0;

struct Pin {
    png: Arc<Vec<u8>>,
    /// The size of the picture in logical pixels at 100 %.
    width: f64,
    height: f64,
    name: String,
    percent: u32,
    locked: bool,
    /// The history entry this is a pin of, if any (the History window marks it as pinned).
    history_id: Option<String>,
    /// The file a Quick Access card showed (a second tap on its Pin button unpins).
    source: Option<PathBuf>,
}

#[derive(Default)]
struct Inner {
    next: u32,
    pins: HashMap<String, Pin>,
}

#[derive(Default)]
pub struct Pins {
    inner: Mutex<Inner>,
    /// The tray's "Unlock pins": only enabled while a pin is locked.
    unlock_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

/// What a pin window knows about itself.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinState {
    label: String,
    name: String,
    percent: u32,
    locked: bool,
    /// The picture is also in the history (enables "Show in History").
    in_history: bool,
}

// ---- pure sizing ----------------------------------------------------------------------------------

/// The next size of the wheel's steps in a direction (`up`: larger). Stays at the end of the range.
fn step_percent(current: u32, up: bool) -> u32 {
    if up {
        STEPS
            .iter()
            .copied()
            .find(|s| *s > current)
            .unwrap_or(STEPS[STEPS.len() - 1])
    } else {
        STEPS
            .iter()
            .rev()
            .copied()
            .find(|s| *s < current)
            .unwrap_or(STEPS[0])
    }
}

/// The size a new pin starts at: 100 %, or smaller when the picture would fill more than `MAX_SHARE` of the screen.
fn start_percent(width: f64, height: f64, screen_w: f64, screen_h: f64) -> u32 {
    let fit = (screen_w * MAX_SHARE / width).min(screen_h * MAX_SHARE / height);
    if fit >= 1.0 {
        return 100;
    }
    ((fit * 100.0).floor() as u32).clamp(10, 100)
}

/// The window size for a size in percent, never below the minimum edge (the picture is shown smaller
/// than the window only by rounding).
fn window_size(width: f64, height: f64, percent: u32) -> (f64, f64) {
    let k = f64::from(percent) / 100.0;
    let (w, h) = (width * k, height * k);
    let grow = (MIN_EDGE / w.min(h)).max(1.0);
    ((w * grow).round(), (h * grow).round())
}

fn png_size(png: &[u8]) -> Result<(u32, u32), String> {
    let reader = png::Decoder::new(std::io::Cursor::new(png))
        .read_info()
        .map_err(|e| format!("This is not a picture LumenGrab can show: {e}"))?;
    let info = reader.info();
    Ok((info.width, info.height))
}

// ---- creating and closing --------------------------------------------------------------------------

/// Where a new pin goes: the monitor under the cursor, its scale and its work area in logical pixels.
fn monitor_for_new_pin(app: &AppHandle) -> Option<(f64, tauri::LogicalPosition<f64>, f64, f64)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    Some((
        scale,
        tauri::LogicalPosition::new(
            f64::from(area.position.x) / scale,
            f64::from(area.position.y) / scale,
        ),
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    ))
}

/// Floats a picture on the screen. `Ok(false)`: eight pins are already open (a notice says so).
pub fn create(
    app: &AppHandle,
    png: Vec<u8>,
    name: String,
    history_id: Option<String>,
    source: Option<PathBuf>,
) -> Result<bool, String> {
    let (px_w, px_h) = png_size(&png)?;
    let pins = app.state::<Pins>();
    let (label, count) = {
        let mut inner = pins.inner.lock().expect("pins");
        if inner.pins.len() >= MAX_PINS {
            drop(inner);
            quick_access::notify(app, quick_access::notice::pin_limit());
            return Ok(false);
        }
        inner.next += 1;
        (format!("{PREFIX}{}", inner.next), inner.pins.len())
    };
    let (scale, origin, screen_w, screen_h) = monitor_for_new_pin(app).unwrap_or((
        1.0,
        tauri::LogicalPosition::new(0.0, 0.0),
        1440.0,
        900.0,
    ));
    // A capture is in device pixels; at 100 % it is as large on the screen as it was when it was taken.
    let (width, height) = (f64::from(px_w) / scale, f64::from(px_h) / scale);
    let percent = start_percent(width, height, screen_w, screen_h);
    let (win_w, win_h) = window_size(width, height, percent);
    let shift = CASCADE * (count % 6) as f64;
    let x = origin.x + ((screen_w - win_w) / 2.0).max(0.0) + shift;
    let y = origin.y + ((screen_h - win_h) / 2.0).max(0.0) + shift;

    pins.inner.lock().expect("pins").pins.insert(
        label.clone(),
        Pin {
            png: Arc::new(png),
            width,
            height,
            name,
            percent,
            locked: false,
            history_id,
            source,
        },
    );
    let built = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?window=pin&label={label}").into()),
    )
    .title("LumenGrab Pin")
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .accept_first_mouse(true)
    .inner_size(win_w, win_h)
    .position(x, y)
    .build();
    match built {
        Ok(window) => {
            platform::configure_pin(&window);
            let handle = app.clone();
            window.on_menu_event(move |w, event| {
                if let Some(pin) = handle.get_webview_window(w.label()) {
                    on_menu_event(&handle, &pin, event.id().as_ref());
                }
            });
            announce(app);
            Ok(true)
        }
        Err(e) => {
            pins.inner.lock().expect("pins").pins.remove(&label);
            Err(format!("The pin could not be shown: {e}"))
        }
    }
}

/// A pin window went away (its X, Esc, "Close all", or the OS).
pub fn on_destroyed(app: &AppHandle, label: &str) {
    if !label.starts_with(PREFIX) {
        return;
    }
    if let Some(pins) = app.try_state::<Pins>() {
        pins.inner.lock().expect("pins").pins.remove(label);
    }
    announce(app);
}

/// Tells the windows that list pins and updates the tray: something about the pins changed.
fn announce(app: &AppHandle) {
    let Some(pins) = app.try_state::<Pins>() else {
        return;
    };
    let any_locked = pins
        .inner
        .lock()
        .expect("pins")
        .pins
        .values()
        .any(|p| p.locked);
    if let Some(item) = pins.unlock_item.lock().expect("pins").as_ref() {
        let _ = item.set_enabled(any_locked);
    }
    let _ = app.emit("pins-changed", ());
}

/// The tray item "Unlock pins" is handed over once, to be enabled and disabled.
pub fn set_unlock_item(app: &AppHandle, item: MenuItem<tauri::Wry>) {
    let _ = item.set_enabled(false);
    *app.state::<Pins>().unlock_item.lock().expect("pins") = Some(item);
}

/// The history entries that float on the screen as pins right now.
pub fn pinned_entries(app: &AppHandle) -> HashSet<String> {
    app.try_state::<Pins>()
        .map(|pins| {
            pins.inner
                .lock()
                .expect("pins")
                .pins
                .values()
                .filter_map(|p| p.history_id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// The picture of a pin, for `lgcapture://localhost/pin-<n>`.
pub fn png(app: &AppHandle, label: &str) -> Option<Arc<Vec<u8>>> {
    let pins = app.try_state::<Pins>()?;
    let inner = pins.inner.lock().expect("pins");
    inner.pins.get(label).map(|p| p.png.clone())
}

pub fn close_all(app: &AppHandle) {
    let labels: Vec<String> = {
        let pins = app.state::<Pins>();
        let inner = pins.inner.lock().expect("pins");
        inner.pins.keys().cloned().collect()
    };
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

/// "Unlock pins": every locked pin takes clicks again.
pub fn unlock_all(app: &AppHandle) {
    let locked: Vec<String> = {
        let pins = app.state::<Pins>();
        let inner = pins.inner.lock().expect("pins");
        inner
            .pins
            .iter()
            .filter(|(_, p)| p.locked)
            .map(|(label, _)| label.clone())
            .collect()
    };
    for label in locked {
        if let Some(window) = app.get_webview_window(&label) {
            set_locked(app, &window, false);
        }
    }
}

/// "Pin last capture": the newest capture of the history.
pub fn pin_last(app: &AppHandle) {
    match history::newest(app) {
        Some(id) => {
            if let Err(e) = pin_history_entry(app, &id) {
                eprintln!("[lumengrab] could not pin the last capture: {e}");
                quick_access::notify(app, quick_access::notice::nothing_to_pin());
            }
        }
        None => {
            quick_access::notify(app, quick_access::notice::nothing_to_pin());
        }
    }
}

fn pin_history_entry(app: &AppHandle, id: &str) -> Result<bool, String> {
    let (path, name) = history::picture_with_name(app, id)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    create(app, bytes, name, Some(id.to_string()), None)
}

// ---- state ------------------------------------------------------------------------------------------

fn state_of(app: &AppHandle, label: &str) -> Option<PinState> {
    let pins = app.try_state::<Pins>()?;
    let inner = pins.inner.lock().expect("pins");
    inner.pins.get(label).map(|p| PinState {
        label: label.to_string(),
        name: p.name.clone(),
        percent: p.percent,
        locked: p.locked,
        in_history: p.history_id.is_some(),
    })
}

fn emit_state(app: &AppHandle, label: &str) {
    if let Some(state) = state_of(app, label) {
        let _ = app.emit_to(label, "pin-state", state);
    }
}

fn set_locked(app: &AppHandle, window: &WebviewWindow, locked: bool) {
    let label = window.label().to_string();
    {
        let pins = app.state::<Pins>();
        let mut inner = pins.inner.lock().expect("pins");
        match inner.pins.get_mut(&label) {
            Some(pin) => pin.locked = locked,
            None => return,
        }
    }
    let _ = window.set_ignore_cursor_events(locked);
    emit_state(app, &label);
    announce(app);
}

/// Resizes the window around its centre to a size in percent.
fn set_percent(app: &AppHandle, window: &WebviewWindow, percent: u32) {
    let label = window.label().to_string();
    let (width, height) = {
        let pins = app.state::<Pins>();
        let mut inner = pins.inner.lock().expect("pins");
        let Some(pin) = inner.pins.get_mut(&label) else {
            return;
        };
        pin.percent = percent;
        (pin.width, pin.height)
    };
    let (w, h) = window_size(width, height, percent);
    let scale = window.scale_factor().unwrap_or(1.0);
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let cx = f64::from(pos.x) / scale + f64::from(size.width) / scale / 2.0;
        let cy = f64::from(pos.y) / scale + f64::from(size.height) / scale / 2.0;
        let _ = window.set_size(tauri::LogicalSize::new(w, h));
        let _ = window.set_position(tauri::LogicalPosition::new(cx - w / 2.0, cy - h / 2.0));
    } else {
        let _ = window.set_size(tauri::LogicalSize::new(w, h));
    }
    emit_state(app, &label);
}

fn percent_of(app: &AppHandle, label: &str) -> Option<u32> {
    state_of(app, label).map(|s| s.percent)
}

// ---- commands (they act on the window they are called from) -----------------------------------------

/// The picture and name of this pin window.
#[tauri::command]
pub fn pin_info(app: AppHandle, window: WebviewWindow) -> Option<PinState> {
    state_of(&app, window.label())
}

/// The mouse wheel: one step larger or smaller.
#[tauri::command]
pub fn pin_zoom(app: AppHandle, window: WebviewWindow, up: bool) {
    if let Some(now) = percent_of(&app, window.label()) {
        set_percent(&app, &window, step_percent(now, up));
    }
}

#[tauri::command]
pub fn pin_reset_size(app: AppHandle, window: WebviewWindow) {
    set_percent(&app, &window, 100);
}

#[tauri::command]
pub fn pin_set_locked(app: AppHandle, window: WebviewWindow, locked: bool) {
    set_locked(&app, &window, locked);
}

/// Starts moving the window with the mouse (the page has no permission for this itself).
#[tauri::command]
pub fn pin_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn pin_close(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn pin_close_all(app: AppHandle) {
    close_all(&app);
}

/// Copies the picture to the clipboard.
#[tauri::command]
pub async fn pin_copy(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let bytes = png(&app, window.label()).ok_or("This pin is no longer available.")?;
    let frame = encode::decode_png(&bytes).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::new(&frame.rgba, frame.width, frame.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

/// Opens the picture in the editor.
#[tauri::command]
pub async fn pin_edit(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let (history_id, source, bytes, name) = {
        let pins = app.state::<Pins>();
        let inner = pins.inner.lock().expect("pins");
        let pin = inner
            .pins
            .get(window.label())
            .ok_or("This pin is no longer available.")?;
        (
            pin.history_id.clone(),
            pin.source.clone(),
            pin.png.clone(),
            pin.name.clone(),
        )
    };
    let path = match (history_id, source) {
        (Some(id), _) => history::edit_path(&app, &id)?,
        (None, Some(path)) if path.is_file() => path,
        _ => {
            // A picture that came from the editor has no file: it goes to a temporary one.
            let safe: String = name
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();
            let path = std::env::temp_dir().join(format!("lumengrab-pin-{safe}.png"));
            crate::fsutil::write_atomic(&path, &bytes)
                .map_err(|e| format!("{}: {e}", path.display()))?;
            path
        }
    };
    crate::document::open_capture(&app, &path).map(|_| ())
}

#[tauri::command]
pub fn pin_show_history(app: AppHandle) {
    history::show(&app);
}

/// The right-click menu of a pin. Native, so it can reach beyond the small window.
#[tauri::command]
pub fn pin_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let state = state_of(&app, window.label()).ok_or("This pin is no longer available.")?;
    let item = |id: &str, text: &str, keys: Option<&str>, enabled: bool| {
        MenuItem::with_id(&app, id, text, enabled, keys).map_err(|e| e.to_string())
    };
    let copy = item("pin-copy", "Copy image", Some("CmdOrCtrl+C"), true)?;
    let edit = item("pin-edit", "Open in editor", None, true)?;
    let reset = item(
        "pin-reset",
        "Reset size to 100%",
        None,
        state.percent != 100,
    )?;
    let lock = item(
        "pin-lock",
        "Lock (click-through)",
        Some("CmdOrCtrl+L"),
        true,
    )?;
    let read = item("pin-text", "Copy text", Some("CmdOrCtrl+Shift+C"), true)?;
    let history = item("pin-history", "Show in History", None, state.in_history)?;
    let close = item("pin-close", "Close pin", Some("CmdOrCtrl+W"), true)?;
    let close_all = item("pin-close-all", "Close all pins", None, true)?;
    let levels: Vec<MenuItem<tauri::Wry>> = [100u32, 80, 60, 40, 20]
        .into_iter()
        .map(|v| item(&format!("pin-opacity-{v}"), &format!("{v}%"), None, true))
        .collect::<Result<_, _>>()?;
    let level_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = levels
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let opacity =
        Submenu::with_items(&app, "Opacity", true, &level_refs).map_err(|e| e.to_string())?;
    let sep = |_: ()| PredefinedMenuItem::separator(&app).map_err(|e| e.to_string());
    let (s1, s2, s3) = (sep(())?, sep(())?, sep(())?);
    let menu = Menu::with_items(
        &app,
        &[
            &copy, &read, &edit, &s1, &opacity, &reset, &lock, &s2, &history, &s3, &close,
            &close_all,
        ],
    )
    .map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// Reacts to a choice in the pin menu (registered once per pin window).
pub fn on_menu_event(app: &AppHandle, window: &WebviewWindow, id: &str) {
    let label = window.label().to_string();
    match id {
        "pin-copy" => {
            let (app, window) = (app.clone(), window.clone());
            tauri::async_runtime::spawn(async move {
                let _ = pin_copy(app, window).await;
            });
        }
        "pin-text" => {
            if let Some(png) = png(app, &label) {
                let app = app.clone();
                std::thread::spawn(move || crate::ocr::read_and_tell(&app, &png));
            }
        }
        "pin-edit" => {
            let (app, window) = (app.clone(), window.clone());
            tauri::async_runtime::spawn(async move {
                let _ = pin_edit(app, window).await;
            });
        }
        "pin-reset" => set_percent(app, window, 100),
        "pin-lock" => set_locked(app, window, true),
        "pin-history" => history::show(app),
        "pin-close" => {
            let _ = window.close();
        }
        "pin-close-all" => close_all(app),
        other => {
            if let Some(value) = other
                .strip_prefix("pin-opacity-")
                .and_then(|v| v.parse::<u32>().ok())
            {
                let _ = app.emit_to(
                    label.as_str(),
                    "pin-opacity",
                    serde_json::json!({ "label": label, "percent": value }),
                );
            }
        }
    }
}

// ---- where pins come from ---------------------------------------------------------------------------

/// A pin of a History entry. `false`: eight pins are already open.
#[tauri::command]
pub async fn pin_history(app: AppHandle, id: String) -> Result<bool, String> {
    pin_history_entry(&app, &id)
}

/// A pin of the picture a Quick Access card shows; a second call unpins it. Returns whether it is pinned now.
#[tauri::command]
pub async fn pin_quick_access(app: AppHandle, id: String) -> Result<bool, String> {
    let path = quick_access::file_of(&app, &id).ok_or("This screenshot is no longer available.")?;
    if let Some(label) = label_of_source(&app, &path) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        return Ok(false);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Screenshot".into());
    let history_id = history::id_for_saved_path(&app, &path);
    create(&app, bytes, name, history_id, Some(path))
}

/// Whether the picture of a card floats as a pin right now.
#[tauri::command]
pub fn pin_is_pinned(app: AppHandle, id: String) -> bool {
    quick_access::file_of(&app, &id).is_some_and(|path| label_of_source(&app, &path).is_some())
}

fn label_of_source(app: &AppHandle, path: &PathBuf) -> Option<String> {
    let pins = app.try_state::<Pins>()?;
    let inner = pins.inner.lock().expect("pins");
    inner
        .pins
        .iter()
        .find(|(_, p)| p.source.as_ref() == Some(path))
        .map(|(label, _)| label.clone())
}

/// A pin of a picture the editor made (the flattened picture, as raw PNG bytes in the request body).
#[tauri::command]
pub async fn pin_from_png(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture is missing.".into());
    };
    let name = "Pinned picture".to_string();
    create(&app, bytes.clone(), name, None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wheel_steps_through_the_sizes_and_stops_at_the_ends() {
        assert_eq!(step_percent(100, true), 110);
        assert_eq!(step_percent(100, false), 90);
        assert_eq!(step_percent(400, true), 400);
        assert_eq!(step_percent(25, false), 25);
        // A size between two steps (a pin that was fitted to the screen) goes to the next one.
        assert_eq!(step_percent(62, true), 67);
        assert_eq!(step_percent(62, false), 50);
    }

    #[test]
    fn a_large_capture_starts_smaller_than_the_screen_and_a_small_one_at_100() {
        assert_eq!(start_percent(400.0, 300.0, 1440.0, 900.0), 100);
        // 2880 x 1800 points on a 1440 x 900 screen: 80 % of the screen is 40 % of the picture.
        assert_eq!(start_percent(2880.0, 1800.0, 1440.0, 900.0), 40);
        assert_eq!(start_percent(100000.0, 100000.0, 1440.0, 900.0), 10);
    }

    #[test]
    fn the_window_never_gets_smaller_than_the_minimum_edge() {
        assert_eq!(window_size(800.0, 400.0, 50), (400.0, 200.0));
        let (w, h) = window_size(300.0, 100.0, 25);
        assert!(w.min(h) >= MIN_EDGE - 1.0, "{w} x {h}");
        // The shape of the picture is kept.
        assert!((w / h - 3.0).abs() < 0.05);
    }

    #[test]
    fn the_size_of_a_png_is_read_without_decoding_it() {
        let frame = crate::capture::Frame {
            width: 12,
            height: 7,
            rgba: vec![255; 12 * 7 * 4],
        };
        let png = encode::encode_png(&frame, encode::Profile::Fast).unwrap();
        assert_eq!(png_size(&png).unwrap(), (12, 7));
        assert!(png_size(b"not a png").is_err());
    }
}
