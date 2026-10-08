//! OS-specific window and input glue. Product logic never branches on the OS: it calls these
//! functions, which have the same signature on every supported OS.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;
