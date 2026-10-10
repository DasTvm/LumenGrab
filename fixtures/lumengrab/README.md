# Golden fixtures

One `.lumengrab` file per released format version (`vN-*.lumengrab`). **Never delete or edit these.**
See [`docs/FORMAT.md`](../../docs/FORMAT.md) section 5. Each fixture has a hand-written `<name>.expected.json`. They were written once by `scripts/make-fixtures.mjs`
(which refuses to overwrite them) and are tested by `src/document/fixtures.test.ts`. Marked binary in `.gitattributes`.
