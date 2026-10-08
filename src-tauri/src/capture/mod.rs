//! Screen capture. Platform-neutral types, the `Capturer` trait and pure helpers (geometry,
//! PNG encoding, session store). OS-specific code lives in `backend/` and `crate::platform`.
//!
//! Units, used consistently everywhere in this module:
//! - **Pixels** (`PxRect`, `Frame`): physical device pixels. Captures are always in pixels.
//! - **Native units** (`NativeRect`): what the OS windowing layer positions windows in, in the
//!   global desktop space with y pointing down. macOS: points. Windows: physical pixels.
//!   Only used to place windows and to map the cursor to a display.

pub mod backend;
pub mod commands;
pub mod encode;
pub mod flow;
pub mod geometry;
pub mod output;
pub mod overlay;
pub mod pixels;
pub mod store;

use std::fmt;

use serde::{Deserialize, Serialize};

/// How a capture is started.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Area,
    Window,
    Fullscreen,
}

/// A rectangle in native units (see module docs).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NativeRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A rectangle in physical pixels, relative to the top-left of a display or frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PxRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    /// Position and size in native units, in the global desktop space.
    pub native: NativeRect,
    /// Size of a full-display capture in physical pixels.
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// Pixels per native unit as reported by the OS (macOS: 1x/2x, Windows: 1.0, 1.5, 2.0 ...).
    pub scale: f64,
    pub is_primary: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    /// Position and size in native units, in the global desktop space.
    pub native: NativeRect,
}

/// A captured image: RGBA8, straight (not premultiplied) alpha, tightly packed, row 0 on top.
#[derive(Clone, Debug)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    /// The OS refuses screen capture (macOS Screen Recording permission).
    PermissionDenied,
    NotFound(String),
    InvalidSelection(String),
    Backend(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PermissionDenied => write!(f, "LumenGrab is not allowed to record the screen."),
            Self::NotFound(what) => write!(f, "{what} is no longer available."),
            Self::InvalidSelection(why) => write!(f, "Invalid selection: {why}"),
            Self::Backend(why) => write!(f, "Capture failed: {why}"),
        }
    }
}

impl std::error::Error for CaptureError {}

pub type CaptureResult<T> = Result<T, CaptureError>;

/// The one interface between our product logic and the OS capture APIs. Backends are swappable
/// (see docs/adr/0001-capture-backend.md); nothing above this trait may depend on a backend.
pub trait Capturer: Send + Sync {
    /// Whether the OS currently allows screen capture. Always true where no permission exists.
    fn permission_granted(&self) -> bool;
    /// Asks the OS for permission (macOS shows its prompt once). Returns the new state.
    fn request_permission(&self) -> bool;
    fn displays(&self) -> CaptureResult<Vec<DisplayInfo>>;
    /// Real, capturable, on-screen windows (no desktop elements, Dock, overlays, own windows),
    /// ordered front to back.
    fn windows(&self) -> CaptureResult<Vec<WindowInfo>>;
    /// Full display, native pixel size, no cursor.
    fn capture_display(&self, display_id: u32) -> CaptureResult<Frame>;
    /// The window alone (overlapping windows excluded), no shadow, no cursor.
    fn capture_window(&self, window_id: u32) -> CaptureResult<Frame>;
}
