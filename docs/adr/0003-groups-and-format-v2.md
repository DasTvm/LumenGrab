# ADR 0003: Groups and format v2 (M4)

Status: accepted (M4). Spec: [`docs/FORMAT.md`](../FORMAT.md) sections 3, 4 and 5.

The editor has a layers panel in which several layers can be grouped, hidden, locked and moved as one. The format v1 had no way to say that, so
M4 is the first format change after M3.

## Decisions

- **A tree, not a flat list with `parentId`.** A `group` layer holds its children in `layers`. Moving, hiding, locking and deleting a group then
  needs no bookkeeping, a child can never point at a group that is gone, and z-order inside a group is just array order. The price is recursive
  code (`src/document/layers.ts`: `walkLayers`, `countLayers`), which is small and tested.
- **The migration `v1 -> v2` is the identity.** A v1 project is a valid v2 project (it just has no groups). `migrateToLatest` stamps the version.
  Nothing in an old file changes; a v1 fixture is expected to open as its `.expected.json` with `version` raised.
- **New files and upgraded files are `formatVersion 2, minReaderVersion 2`.** A v1 reader treats `group` as an unknown layer: it keeps it but does not
  draw it or its children, so a redaction inside a group would be missing from a flat export. Raising `minReaderVersion` makes such a reader open
  the file read-only from `preview.png` instead. No v1 build was ever released, so this costs nothing today; the rule stays correct for later.
- **Redactions inside groups are baked first**, depth first, skipping those with a hidden layer or group around them (`visibleRedactions` walks
  the tree). A hidden group hides its redactions too, the same rule as a hidden redaction layer.
- **Limits:** at most 8 groups inside each other (error with the path beyond that), and the 5000-layer limit counts the whole tree. The depth is
  checked while parsing, so a hostile file cannot make the schema recurse without bound.
- **Errors keep their path:** `layers.1.layers.0.width`. The group branch of `LayerSchema` parses the group's own fields, then each child with the
  same dispatch by `type`, so a bad child is never hidden behind an "unknown layer" fallback.
- **Fixture `v2-groups`** (nested, hidden and locked groups, a redaction inside a nested group, an unknown field on a group) is written by
  `scripts/make-fixtures.mjs` next to the v1 fixtures. The script now keeps existing fixtures instead of failing on them; it still never overwrites.
