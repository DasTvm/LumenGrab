//! OS capture backends. Exactly one is compiled in; `default_capturer()` returns it.
//! macOS: ScreenCaptureKit. Windows: xcap (WGC by default, GDI without the `wgc` feature).

use std::sync::Arc;

use super::Capturer;

#[cfg(target_os = "macos")]
mod sck;
#[cfg(target_os = "windows")]
mod xcap_windows;

pub fn default_capturer() -> Arc<dyn Capturer> {
    #[cfg(target_os = "macos")]
    return Arc::new(sck::SckCapturer);
    #[cfg(target_os = "windows")]
    return Arc::new(xcap_windows::XcapCapturer);
}
