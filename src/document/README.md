# document

Document model, Zod schemas, migrations and (de)serialization for `.lumengrab` files (M3).

Before changing anything here, re-read [`docs/FORMAT.md`](../../docs/FORMAT.md) and AGENTS.md section 5.
The spec and the code change in the same commit.

- `schema.ts` Zod schemas (loose objects: unknown fields survive), `limits.ts`, `errors.ts`
- `container.ts` ZIP reading (streaming, counts real bytes) and writing; `png.ts`, `hash.ts`
- `read.ts` `openDocument`, `write.ts` `createDocument` / `serializeDocument`, `migrations/` forward-only migrations
- `render/` flat rendering for previews and exports (crop, redactions baked, downscale)
- No Tauri imports here: everything runs in the browser mock and in Vitest.
