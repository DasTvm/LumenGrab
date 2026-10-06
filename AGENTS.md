# AGENTS.md

Project guide for AI coding agents (Claude Code, Codex). Read this fully before changing anything.
App name: **LumenGrab**. File extension: `.lumengrab` (see `docs/FORMAT.md`).

## 1. What we are building

A **free, source-available screenshot and screen-recording app** for **macOS and Windows** (no Linux). It is inspired by the category of tools like CleanShot X, but it is its own product.

Core value:
1. Fast capture (area, window, fullscreen, later scrolling) via global hotkey.
2. A great **editor** to annotate, redact and crop after the fact.
3. A **presentation layer** (backgrounds, padding, shadows, window/device frames) that turns plain screenshots into presentation-ready visuals.
4. Our **own editable file format (`.lumengrab`)**, so any capture can be reopened and edited later from a single file.

### Product principles (hard constraints)
- **Free forever.** No paid tiers, no license keys, no accounts, no login.
- **No hosting by us.** No backend, no cloud, no servers we have to run or pay for.
- **Local-first and private.** Everything (OCR, auto-redact, any AI feature) runs on the user's device. No telemetry, no network calls except the updater and user-configured upload targets.
- **Simple and good-looking.** Few settings, sensible defaults, polished UI. If a feature needs a manual to be understood, simplify it.
- **Mac and Windows have feature parity** wherever the OS allows it.

### Originality / IP rules
We build similar features, not a copy.
- Do **not** reuse names, icons, copy text, screenshots, videos, color schemes or exact UI layouts of other products (including CleanShot).
- Do **not** reuse any third-party assets. Backgrounds/gradients are generated in code or created by us.
- Features are free to implement; expression is not. When in doubt, design it our own way.

### License and public repo
- The repository is **public**. The source code is licensed under **PolyForm Noncommercial License 1.0.0** (source-available, **not** OSI open source). Others may read and use the code for noncommercial purposes only. Commercial use, reselling, and building competing commercial products from this code are not allowed.
- The compiled app is free for users. It ships with short terms of use (`EULA.md`): free to use, no reselling or repackaging.
- The name **LumenGrab** and its logo are not licensed for reuse (stated in the README).
- Required files in the repo root: `LICENSE` (exact official PolyForm Noncommercial 1.0.0 text, never edited or paraphrased), `README.md`, `CONTRIBUTING.md`, `EULA.md`, `THIRD_PARTY_LICENSES`.
- **The repo becomes public once `LICENSE` and `README.md` are verified, including the full git history.** Until then it stays private and nothing is pushed. Never commit secrets, tokens, keys, personal data, customer data, or real screenshots of private content. Secrets live only in GitHub Actions secrets or local env files that are in `.gitignore`. Add a secret scan (e.g. gitleaks) to CI.

## 2. Tech stack

| Layer | Choice |
|---|---|
| App shell | **Tauri 2** (Rust backend, system WebView) |
| UI | **React + TypeScript (strict) + Tailwind + shadcn/ui (Radix)** |
| Editor canvas | **Konva.js** (react-konva) |
| State | Zustand (+ immer) |
| Animations | Motion (framer-motion successor) |
| Schema validation | **Zod** |
| Capture / recording | Rust crates `xcap` and `scap` (evaluate, wrap behind our own trait) |
| Video encoding | FFmpeg sidecar, **LGPL build only** |
| OCR | Local only: platform-native (macOS Vision, Windows.Media.Ocr) behind one interface; Tesseract as fallback |
| Package manager | pnpm |
| Tests | Vitest (unit), Playwright (UI in browser mock mode), `cargo test` (Rust) |
| CI/CD | GitHub Actions (macOS + Windows runners), GitHub Releases |

Do not add a dependency without checking: license, maintenance status, and bundle size. Because our own code is under PolyForm Noncommercial, only permissive licenses are allowed in the app itself: MIT, Apache-2.0, BSD, ISC, MPL-2.0. **No GPL/AGPL code linked into the app** (it would force us to relicense). LGPL only as dynamically linked library or separate sidecar process (e.g. FFmpeg). Keep `THIRD_PARTY_LICENSES` up to date. Prefer fewer dependencies.

## 3. Repository layout (target)

```
/
├─ AGENTS.md / CLAUDE.md
├─ LICENSE / README.md / CONTRIBUTING.md / EULA.md / THIRD_PARTY_LICENSES
├─ docs/
│  ├─ FORMAT.md          # .lumengrab file format spec (source of truth)
│  └─ ROADMAP.md
├─ src/                  # React app
│  ├─ app/               # windows: overlay, editor, settings, history, pin
│  ├─ editor/            # Konva editor, tools, layers
│  ├─ presentation/      # background tool, frames, presets
│  ├─ document/          # document model, zod schemas, migrations, (de)serialization
│  ├─ platform/          # typed wrappers around Tauri commands + browser mocks
│  └─ ui/                # shared components, design tokens
├─ src-tauri/
│  └─ src/               # thin Rust: capture, hotkeys, windows, fs, ocr, recording
├─ fixtures/lumengrab/        # golden .lumengrab files for every format version (NEVER delete)
└─ .github/workflows/
```

## 4. Architecture rules

1. **Rust stays thin.** Rust does only what the browser cannot: screen capture, global hotkeys, window management, file association, OCR bridge, recording, filesystem. All product logic and UI live in TypeScript.
2. **Typed IPC.** Every Tauri command has a TypeScript wrapper in `src/platform/` with explicit input/output types. No raw `invoke()` calls scattered through the UI.
3. **Browser mock mode.** The whole frontend must run in a plain browser (`pnpm dev:web`) with mocked platform calls (e.g. a fake capture returning a sample image). This lets agents verify UI with Playwright screenshots without building the native app. Keep this working at all times.
4. **OS differences are isolated** behind interfaces in `src/platform/` and `src-tauri/src/platform/{macos,windows}`. No `if windows` sprinkled through business logic.
5. **Coordinates:** The document stores everything in **source-image pixel space**, never in screen or CSS pixels, so files are DPI-independent.
6. **Performance:** App start to ready in the tray < 1 s target. Capture-to-overlay latency must feel instant. Avoid heavy work on the main thread.

## 5. The `.lumengrab` file format (HARD RULES)

We use **our own container format, Variant A**: a single ZIP file with the extension `.lumengrab`. The user must be able to continue editing with **only this one file**, with no other files needed.

The full spec is in `docs/FORMAT.md`. That file is the **source of truth**. Rules that apply to every change:

1. A `.lumengrab` file is a ZIP containing `manifest.json`, `project.json`, `source.png` (unmodified original), optional `assets/`, and `preview.png`.
2. **Never break old files.** Every `.lumengrab` ever written by a released version must open in all later versions.
3. `project.json` has an integer `version`. Any change to the schema means: bump the version, write a **migration** `vN -> vN+1`, add a **golden fixture** in `fixtures/lumengrab/` and a test that opens it. No exceptions.
4. **Unknown fields are preserved** on load and save (forward compatibility). Files from a newer version must open read-only with a clear message instead of crashing or silently losing data.
5. All input is validated with Zod. Corrupt or malicious files must produce a friendly error, never a crash. Guard against zip-slip, oversized entries and decompression bombs.
6. Writes are **atomic** (write to temp file, then rename).
7. The **original image is never modified.** Crop, annotations, redactions and presentation are parameters on top of it.
8. Fonts: only bundled, freely licensed fonts, referenced by id. No system-font dependency inside files.
9. Editing the format spec and the code must happen in the same change. If `docs/FORMAT.md` and the code disagree, that is a bug.

### Redaction safety (security-critical)
- Blur, pixelate and solid redactions must **actually destroy the pixels** in any exported flat image (PNG/JPG/clipboard). Never export a redaction as a removable overlay.
- Pixelate uses randomization so it cannot be reversed.
- A `.lumengrab` file contains the **unredacted original** by design. The UI must show a clear notice when saving or sharing a `.lumengrab` that contains redactions, and **flat export is the default** for sharing.

## 6. Design and UX rules

- Design source of truth: **Figma** (use the Figma MCP when a link is provided). Implement from the design, do not invent a generic look.
- Use design tokens (colors, radius, spacing, type) from one place (`src/ui/tokens`). No hard-coded colors in components.
- Light and dark mode from day one. Respect system setting.
- Native feel: correct window behavior per OS, system fonts for UI chrome, proper keyboard shortcuts (Cmd on macOS, Ctrl on Windows), accessible focus states.
- Avoid the generic "AI-generated" look: no default purple gradients, no random emoji icons, no cluttered toolbars. Fewer, better controls.
- Every feature needs: empty state, error state, and keyboard access.

## 7. Feature scope and milestones

Work in **small milestones**. Finish, test and commit one before starting the next. Never attempt "build the whole app" in one go.

**M0 – Scaffold:** Tauri 2 + React + TS + Tailwind + shadcn, lint/format, Vitest, Playwright, browser mock mode, CI building macOS + Windows artifacts, tray icon.
**M1 – Capture MVP:** global hotkey, area / window / fullscreen capture, save to file + copy to clipboard, multi-monitor + mixed DPI.
**M2 – Quick Access Overlay:** small overlay after capture (copy, save, edit, drag out, auto-close).
**M3 – Document model + `.lumengrab` format:** zod schemas, read/write, migrations scaffold, golden fixture v1, preview generation, file association.
**M4 – Editor:** crop/resize, arrow, line, rectangle, ellipse, text, counter, highlighter, pencil, spotlight, blur/pixelate/solid redaction, undo/redo, export PNG/JPG/WebP.
**M5 – Presentation:** background tool (generated gradients, solid, own image), padding, radius, shadow, aspect ratio presets, auto-balance, saved presets, window frames.
**M6 – History, pin/floating screenshots, OCR (copy text, QR), All-in-one capture mode.**
**M7 – Screen recording** (MP4/GIF, mic + system audio, click/keystroke overlay).
**M8 – Scrolling capture.**
**Later:** video editor with smart zooms, device mockups, 3D tilt, local auto-redact (emails, IBANs, API keys), multi-format export, user-configured upload targets (S3/WebDAV/own Drive).

## 8. Release and distribution (public repo, free)

One public repo. No second repo, no servers.

- **GitHub Actions** (free and unlimited for public repos): on push/PR run lint, typecheck, unit tests, secret scan; on tag `v*` build **unsigned** installers for macOS (`.dmg`) and Windows (NSIS `.exe` / `.msi`) and publish them as **GitHub Releases** in this same repo.
- **Auto-update:** Tauri updater reads `latest.json` from the GitHub Release assets of this repo. The updater signing key is stored only as GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). The public key goes into `tauri.conf.json`. Never commit the private key.
- Installers via Tauri bundler. Website on GitHub Pages / Cloudflare Pages (free tier). Later: Homebrew Cask and winget manifests pointing at the GitHub Releases.
- **Code signing:** no free Windows signing is available (SignPath Foundation requires an OSI open-source license). Start unsigned and document the SmartScreen warning ("More info -> Run anyway") in the README. macOS starts **unsigned/ad-hoc** (no paid Apple account); document the first-launch steps and handle the screen-recording permission flow gracefully, including re-prompts after updates. Revisit signing once the app has users.
- **Privacy promise** (README and website): no telemetry, no network access except update checks and user-configured upload targets.
- The `.lumengrab` format spec (`docs/FORMAT.md`) is public as part of the repo.

## 9. Working agreements for agents

- Read this file and `docs/FORMAT.md` before starting. Re-read the relevant section before touching the format.
- Plan briefly, then implement in small, reviewable commits. Conventional Commits (`feat:`, `fix:`, `chore:`...).
- Run lint, typecheck and tests before declaring something done. Verify UI changes with a Playwright screenshot in browser mock mode.
- Keep it simple. Prefer the native/standard solution over clever workarounds. If an approach feels over-engineered, stop and propose a simpler one.
- If a requirement is ambiguous or conflicts with these rules, ask instead of guessing.
- Do not delete golden fixtures, do not weaken tests to make them pass, do not commit secrets.
- Document decisions that are non-obvious in `docs/` (short ADR-style notes).

## 10. Commands

Fill in after M0 and keep this section current:

```
pnpm install
pnpm dev:web        # frontend in browser with mocked platform calls
pnpm tauri dev      # full native app
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e       # Playwright
pnpm tauri build    # local installer build
```
