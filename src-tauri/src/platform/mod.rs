//! OS-specific window and input glue. Product logic never branches on the OS: it calls these
//! functions, which have the same signature on every supported OS.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(target_os = "macos")]
mod ocr_macos;
#[cfg(target_os = "macos")]
pub use ocr_macos::recognize_text;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;
#[cfg(target_os = "windows")]
mod ocr_windows;
#[cfg(target_os = "windows")]
pub use ocr_windows::recognize_text;
