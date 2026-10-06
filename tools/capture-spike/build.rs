fn main() {
    // screencapturekit's Swift bridge links the Swift runtime via @rpath; a plain cargo binary has no
    // rpath, so dyld fails with "Library not loaded: @rpath/libswift_Concurrency.dylib".
    // The system Swift runtime lives in /usr/lib/swift (macOS 12.3+). The Tauri app's build.rs
    // would need the same line.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
