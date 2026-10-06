//! Throwaway M1 diagnostics. Compares screen capture backends and writes a Markdown report plus PNGs.
//!
//!   macOS:   cargo run --release
//!   Windows: cargo run --release                (xcap + GDI)
//!            cargo run --release --features wgc (xcap + Windows.Graphics.Capture)
//!   Options: --out <dir>  --no-dpi-awareness (Windows only: shows what happens in a DPI-unaware process)
//!
//! The Windows process is made per-monitor DPI aware first, because the Tauri app will be too.

mod report;
#[cfg(target_os = "macos")]
mod sck_backend;
mod xcap_backend;

use report::Report;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
mod mac_permission {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    /// Does not prompt. True only if this process (or the app that launched it) may record the screen.
    pub fn preflight() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
}

#[cfg(windows)]
fn init_dpi_awareness(enable: bool) -> &'static str {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    if !enable {
        return "NOT set (--no-dpi-awareness): process is DPI unaware";
    }
    match unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } {
        Ok(()) => "PER_MONITOR_AWARE_V2",
        Err(_) => "PER_MONITOR_AWARE_V2 requested but the call failed (already set?)",
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args
        .iter()
        .position(|a| a == "--out")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("lumengrab-capture-spike"));
    let mut r = Report::new(out);

    r.line("# Capture spike report");
    r.line("");
    r.line(format!(
        "- OS: {} / {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    r.line(format!(
        "- xcap backend under test: **{}**",
        xcap_backend::label()
    ));
    #[cfg(windows)]
    r.line(format!(
        "- DPI awareness: {}",
        init_dpi_awareness(!args.iter().any(|a| a == "--no-dpi-awareness"))
    ));
    #[cfg(target_os = "macos")]
    {
        let granted = mac_permission::preflight();
        r.line(format!(
            "- CGPreflightScreenCaptureAccess (no prompt): **{granted}**"
        ));
        if !granted {
            r.line("- **Screen Recording permission is NOT granted to this process.** Results below show what each backend does without it. Grant it to the app that launched this terminal/shell, then re-run.");
        }
    }

    let xcap_shots = xcap_backend::run(&mut r);
    #[cfg(target_os = "macos")]
    sck_backend::run(&mut r, &xcap_shots);
    #[cfg(not(target_os = "macos"))]
    let _ = xcap_shots;

    let name = format!(
        "report-{}-{}.md",
        std::env::consts::OS,
        if cfg!(feature = "wgc") {
            "wgc"
        } else {
            "default"
        }
    );
    let path = r.save(&name);
    println!(
        "\nReport and PNGs written to {}",
        path.parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    );
}
