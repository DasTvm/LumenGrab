# Auto-update setup (not enabled yet)

Status: **documentation only.** The updater plugin is deliberately **not registered** in M0 and there is
no updater config in `tauri.conf.json`. It gets added in a later milestone, with the real public key,
before the first release. Until then the release workflow builds plain unsigned installers
(`uploadUpdaterJson: false`).

Design: the Tauri updater reads a static `latest.json` from the assets of this repo's latest GitHub
Release. No server of ours is involved. This only works while the repo (and its releases) are
**public**; a private repo would need authentication the app must not carry.

## 1. Generate the signing key (once, locally)

```sh
pnpm tauri signer generate -w ~/.tauri/lumengrab.key
```

- This writes a private key file and prints the public key. Choose a password.
- **Never commit the private key or the password.** Keep a backup in a password manager: if it is lost,
  existing installs can no longer be updated.
- `.gitignore` already blocks `*.key` and `tauri-signing*` as a safety net.

## 2. Store the secrets in GitHub

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

| Secret                               | Value                                             |
| ------------------------------------ | ------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | content of `~/.tauri/lumengrab.key` (or its path) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen above                         |

The public key is not secret and goes into `tauri.conf.json` (step 3).

## 3. Enable the updater (the later milestone)

1. Add the plugin: `pnpm tauri add updater` (adds `tauri-plugin-updater` and `@tauri-apps/plugin-updater`),
   and register it in `src-tauri/src/lib.rs`. Check license and size first (AGENTS.md section 2).
2. `src-tauri/tauri.conf.json`:
   ```json
   {
     "bundle": { "createUpdaterArtifacts": true },
     "plugins": {
       "updater": {
         "pubkey": "<PUBLIC KEY FROM STEP 1>",
         "endpoints": ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"]
       }
     }
   }
   ```
3. Add `"updater:default"` to `src-tauri/capabilities/default.json` and wrap the calls in a typed
   wrapper in `src/platform/`.
4. `.github/workflows/release.yml`: uncomment the two `TAURI_SIGNING_*` env lines and set
   `uploadUpdaterJson: true`.
5. Tag a test release and verify that `latest.json` and the `.sig` files appear in the release assets,
   and that an older build offers the update.

## Notes

- The updater signature is independent of OS code signing. Unsigned installers still trigger Gatekeeper
  and SmartScreen warnings (see README).
- Rotating the key breaks updates for existing installs. Treat it as permanent.
