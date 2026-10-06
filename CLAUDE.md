# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- `AGENTS.md` (imported above) is the single source of truth for project rules. Do not duplicate rules here; edit `AGENTS.md` instead so Claude Code and Codex stay in sync.
- The `.lumengrab` file format rules in AGENTS.md section 5 and `docs/FORMAT.md` are non-negotiable. Before any change in `src/document/`, re-read `docs/FORMAT.md`.
- Use plan mode for anything touching the document model, the file format, or native capture code. Show the plan before implementing.
- For UI work, use browser mock mode (`pnpm dev:web`) and verify with Playwright screenshots before reporting done.
- When a Figma link is provided, use the Figma MCP (`get_design_context`) and implement with the existing design tokens.
- Keep Rust changes minimal and well-commented; keep product logic in TypeScript.
