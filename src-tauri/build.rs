use std::{path::PathBuf, process::Command};

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_swift_runtime();
    }
    tauri_build::build();
}

/// The screencapturekit crate compiles a Swift bridge. Two things are needed to link and run it:
/// 1. `-rpath /usr/lib/swift`: without it dyld fails at launch with
///    "Library not loaded: @rpath/libswift_Concurrency.dylib". The system Swift runtime lives there
///    (macOS 12.3+).
/// 2. The Swift compatibility libraries (`libswiftCompatibility56.a` ...) at link time. The crate looks
///    in `<developer dir>/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx`, which only exists
///    with a full Xcode. With only the Command Line Tools they are in `<developer dir>/usr/lib/swift/macosx`.
fn link_swift_runtime() {
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    let developer_dir = Command::new("xcode-select")
        .arg("-p")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()));
    if let Some(dir) = developer_dir {
        let candidates = [
            dir.join("Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
            dir.join("usr/lib/swift/macosx"),
        ];
        for path in candidates
            .iter()
            .filter(|p| p.join("libswiftCompatibility56.a").exists())
        {
            println!("cargo:rustc-link-search=native={}", path.display());
        }
    }
}
