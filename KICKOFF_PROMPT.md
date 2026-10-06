# Kickoff prompt

Paste this into Claude Code (or Codex) in an empty git repo that already contains `AGENTS.md`, `CLAUDE.md` and `docs/FORMAT.md`.

---

You are starting a new project. First read `AGENTS.md` and `docs/FORMAT.md` completely. They are binding.

**Project:** a free, source-available screenshot app called **LumenGrab** for macOS and Windows (no Linux) with a powerful editor, a presentation layer (backgrounds, frames), and our own single-file editable format `.lumengrab`. No backend, no accounts, no paid services, everything local.

**Your task now: Milestone M0 (Scaffold), then stop and report.**

1. Initialize a Tauri 2 project with React, TypeScript (strict), Tailwind and shadcn/ui, using pnpm.
2. Create the folder structure from AGENTS.md section 3 (empty folders with a short README or `.gitkeep` where needed).
3. Set up ESLint, Prettier, TypeScript strict mode, Vitest and Playwright.
4. Implement **browser mock mode**: `pnpm dev:web` runs the frontend in a plain browser with a `src/platform/` layer that returns mocked data (e.g. a fake capture using a bundled sample image). Add one Playwright test that opens the mock app and takes a screenshot.
5. Add a tray icon with a minimal menu (Capture, Settings, Quit) and a settings window placeholder, native build only.
6. Add design tokens in `src/ui/tokens` (colors, radius, spacing, type) with light and dark mode. Use neutral placeholder values; the real design comes from Figma later.
7. Add GitHub Actions for a **public** repo: on push and PR run lint, typecheck, unit tests and a secret scan (gitleaks); on tag `v*` (and manual `workflow_dispatch`) build **unsigned** installers for **macOS (.dmg)** and **Windows (NSIS .exe)** and attach them to a GitHub Release **in this same repo**. Use Rust and pnpm caching. Do not add signing steps that need paid certificates. Configure the Tauri updater to read `latest.json` from this repo's releases. Document the updater key setup (GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) but do not generate or commit any keys.
8. Update the "Commands" section in `AGENTS.md` with the real commands.
9. Add the legal files (the repo is public, see AGENTS.md "License and public repo"):
   - `LICENSE`: the **exact official PolyForm Noncommercial License 1.0.0 text**. Fetch it from the official source (https://polyformproject.org/licenses/noncommercial/1.0.0 or the `polyformproject/polyform-licenses` repo on GitHub). Do **not** write it from memory, paraphrase it, or modify it. If you cannot fetch it, create a clearly marked TODO and tell me. Add a `Required Notice: Copyright (c) <YEAR> <YOUR NAME>` line only if I confirm the name.
   - `README.md`: what LumenGrab is, features (planned), how to run, the license in one plain sentence ("Source available. Free for noncommercial use. Commercial use and reselling are not allowed."), that the name and logo are not licensed for reuse, the privacy promise, and the first-launch notes for unsigned apps (macOS Gatekeeper, Windows SmartScreen).
   - `CONTRIBUTING.md`: short; state that pull requests are currently not accepted (or, if accepted later, that contributions are licensed under the same license and may also be used by the maintainer commercially).
   - `EULA.md`: short plain-language terms of use for the compiled app (free to use, no reselling or repackaging, provided as is). Mark it as a draft for me to review.
   - `THIRD_PARTY_LICENSES`: generate from the dependency tree (cargo-about / license-checker or similar) and add a script to refresh it.
   - `.gitignore` covering `node_modules`, `target`, `dist`, `.env*`, OS files, and signing keys.

**Rules for this task**
- Keep it minimal and boring. No features beyond the list above.
- Do not implement capture, editor, or the file format yet.
- Run lint, typecheck, tests and `pnpm tauri build` (or at least `pnpm tauri dev`) and report what works and what does not.
- Make small commits using Conventional Commits.
- If something in AGENTS.md is unclear or conflicts with reality (e.g. a crate does not support something), stop and tell me instead of guessing.

When done, give me: a summary, the exact commands to run the app, known issues, and your proposed plan for **M1 (Capture MVP)**, including which Rust crate (`xcap` / `scap`) you recommend after checking their current maintenance status and Windows/macOS support. Wait for my approval before starting M1.

---

## Prompt for M3 (file format), to use later

Read `docs/FORMAT.md` and AGENTS.md section 5. Implement `src/document/`: Zod schemas for manifest and project v1, the in-memory document model, read/write of `.lumengrab` ZIP files with all limits and zip-slip protection, atomic writes, preview generation, the migration scaffold, and golden fixture `fixtures/lumengrab/v1-basic.lumengrab`. Add the round-trip, fixture and fuzz tests from section 9 of the spec. Register the file association in `tauri.conf.json`. Do not build editor UI in this task. If you find gaps or contradictions in the spec, propose a spec change first and update `docs/FORMAT.md` in the same commit as the code.
