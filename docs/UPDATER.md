# Auto-update

Status: **built, waiting for the signing key.** The updater code, the Settings page, the Quick Access cards, the tray
entry and the release workflow are in. Until the public key is in `src-tauri/tauri.conf.json`, the updater is **not
registered** and nothing goes online: Settings > Updates says "Updates are not set up in this build". Design and
decisions: [ADR 0008](adr/0008-in-app-updates.md).

How it works for a user: once a day (or on "Check now") LumenGrab asks GitHub for `latest.json` of the newest
**published** release. If there is a newer version, a card says so. "Install and restart" downloads the signed package in the
background, a card says when it is ready, and the restart installs it. Documents with unsaved changes ask "Save changes?"
first. This only works while the repo and its releases are **public**; a private repo would need credentials the app must not carry.

## 1. Generate the signing key (once, locally)

```sh
pnpm tauri signer generate -w ~/.tauri/lumengrab.key
```

- It writes the private key file and prints the public key. Choose a password.
- **Never commit the private key or the password.** Keep a backup in a password manager: if it is lost, existing installs
  can never be updated again (they only accept packages signed with this key).
- `.gitignore` already blocks `*.key` and `tauri-signing*` as a safety net.

## 2. Store the secrets in GitHub

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

| Secret                               | Value                                             |
| ------------------------------------ | ------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | content of `~/.tauri/lumengrab.key` (or its path) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen above                         |

## 3. Put the public key into the app

The public key is not secret. Add it to `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "<the public key printed in step 1>",
    "endpoints": ["https://github.com/DasTvm/LumenGrab/releases/latest/download/latest.json"]
  }
}
```

From then on the build registers the updater (`src-tauri/src/updater.rs`), shows the tray entry "Check for Updates…" and
the Settings page. Nothing else needs to change.

## 4. Release (what the workflow does)

A tag `v*` runs `.github/workflows/release.yml`: it builds both installers **and** the signed update packages
(`--config src-tauri/tauri.release.conf.json` turns on `createUpdaterArtifacts`), uploads them with `latest.json` to a **draft**
release. Then:

1. Open the draft, write the notes in the shape `### New` / `### Improved` / `### Fixed` with `- ` bullets (the update window
   sorts them by these headings; anything else is only a link to the release page), delete the groups you do not need.
2. Check that the assets contain the installers, `*.app.tar.gz` + `.sig` (macOS), the NSIS `.exe` + `.sig` (Windows) and `latest.json`.
3. Publish. Only a published release is served as "latest"; installed apps find it within a day.

A manual run of the workflow (`workflow_dispatch`) only builds installers as workflow artifacts: no update packages, no release.

## 5. Try an update without publishing anything

A development build or a release build made with `--features dev-hooks` reads two environment variables:

- `LUMENGRAB_DEV_UPDATE_ENDPOINT=http://127.0.0.1:8765/latest.json` looks there instead of GitHub (the build also needs
  `dangerousInsecureTransportProtocol: true` in its updater config for plain http).
- `LUMENGRAB_DEV_UPDATE=install` checks, downloads and installs an update by itself and logs every state.

The test of the whole path (throwaway key, an old and a new build, a local server): build the new version and the
old one with `--config` files that carry a throwaway public key, serve `latest.json` and the `.tar.gz` of the new
one, start the old app with the two variables and watch it restart as the new version. See ADR 0008 for what was verified.

## Notes

- The update signature is independent of OS code signing. Unsigned installers still trigger Gatekeeper and SmartScreen
  warnings (see README). Without an Apple signature macOS may ask for Screen Recording permission again after an update.
- The update check is the only network access LumenGrab has (README, privacy promise). With "Check for updates automatically" off,
  the app goes online only when the user presses "Check now".
