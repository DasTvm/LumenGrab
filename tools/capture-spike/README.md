# capture-spike

Throwaway diagnostics for M1. It compares screen-capture backends on the machine you run it on and writes a
Markdown report plus PNGs. It is **not** part of the app (own `Cargo.lock`, no workspace), so its
dependencies never reach the app's `THIRD_PARTY_LICENSES`. Findings and the decision are in
[`docs/adr/0001-capture-backend.md`](../../docs/adr/0001-capture-backend.md).

```sh
cd tools/capture-spike
cargo run --release                     # macOS: xcap vs ScreenCaptureKit. Windows: xcap + GDI
cargo run --release --features wgc      # Windows: xcap + Windows.Graphics.Capture
cargo run --release -- --out <dir>      # default output: <temp dir>/lumengrab-capture-spike
cargo run --release -- --no-dpi-awareness   # Windows only: what happens in a DPI-unaware process
```

- macOS needs the Swift toolchain (Xcode Command Line Tools) to build the ScreenCaptureKit bridge.
- macOS needs **Screen Recording** permission for the app that launched your terminal/shell. Without it the
  report says so and most content tests are meaningless (xcap returns blank images, ScreenCaptureKit errors).
- Windows runs are made per-monitor DPI aware first, like the Tauri app will be.
- Send back `report-<os>-<default|wgc>.md` (and a few of the PNGs if something looks wrong).
