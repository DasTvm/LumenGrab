# Security

## Report a problem

Please do not open a public issue for a security problem. Use **Security > Report a vulnerability** on the
repository page (GitHub private vulnerability reporting). You get an answer, and the fix is published before the
details are.

## What LumenGrab does and does not do

- **No account, no telemetry, no server of ours.** The only network request is the update check: the app asks
  GitHub for one small file (`latest.json`) and, if you update, downloads the new version from the GitHub release.
  GitHub sees your IP address like any website you visit. You can turn the daily check off in Settings > Updates.
- **Updates are signed.** The app installs an update only if its signature matches the public key built into the app.
- **A page never names a path.** The windows ask the native side for "their" file; saving goes only to a place you
  just picked in a dialog. A damaged or hostile `.lumengrab` file cannot make the app read or overwrite other files
  (docs/FORMAT.md section 9, `src-tauri/src/document.rs`).
- **Files are checked.** Archive names, sizes and decompressed sizes are limited, and everything in a file is validated.
- **Code in a file does not run by itself.** A background made with your own GLSL code from a file somebody else gave
  you does not run until you press "Run custom code" (`src/shader/trust.ts`). Code you write yourself runs, and a
  layer that takes too long is switched off.
- **The window shows only our own pages.** A strict content security policy blocks every other origin, there is no
  HTML injection sink in the interface, and the only web address the app opens is this repository's Releases page.
- **Screenshots stay on your computer.** They are written where you chose (`Pictures/LumenGrab` by default). While you
  edit, a recovery copy of the open document is kept in the app's data folder until you save or discard it. A
  `.lumengrab` file contains the unredacted original by design; share a flat export instead.

## Releases

Installers are built by GitHub Actions from the tagged source, with the actions pinned to exact commits. The macOS build
is signed and notarized when the signing secrets are set (docs/MACOS_SIGNING.md). The Windows build is not code signed.
