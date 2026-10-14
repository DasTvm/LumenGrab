# ADR 0008: In-app updates

Status: accepted. How to set it up and release: [`docs/UPDATER.md`](../UPDATER.md).

People should not have to fetch every version from GitHub by hand: the app says when a new version is out and installs it.
It must not break the privacy promise ("no network access except update checks") and must never lose work.

## Decisions

- **One state machine, in Rust** (`src-tauri/src/updater.rs`): `unavailable | idle | checking | upToDate | available | downloading | ready | failed`.
  Settings, the Quick Access cards and the tray entry all read it (command `update_state`, event `update-state`), so they cannot disagree.
  The plugin is `tauri-plugin-updater` (Apache-2.0 OR MIT), used from Rust; there is no JavaScript package.
- **Not set up = silent.** The plugin is only registered when `tauri.conf.json` has a public key. Without it the state is `unavailable`, nothing is
  requested, the tray entry is not there and Settings says so. A build from source never phones home.
- **The only network request is the update check** (`latest.json` of the newest published GitHub release, then the package when the user asks for it).
  Once a day in the background when "Check for updates automatically" is on (default on), and on "Check now". Nothing about the user is sent. The last good check
  and a skipped version live in `updates.json` in the app's config folder.
- **Nothing is installed without the user.** A found update is announced (card; Settings page), downloaded when the user chooses "Install and restart",
  announced again when ready, and installed on the restart they confirm. The package signature (minisign, key pair made by us) is checked before anything is installed;
  a failed check says "security check" and leaves the installed version untouched.
- **Unsaved work is asked about first.** "Install and restart" with unsaved documents opens a dialog listing them; confirming makes every such document ask its own
  "Save changes?" (the normal close path); only when the last one is dealt with the update installs. "Cancel" on any of those questions calls off the restart
  (`document_close_cancelled`). Recovery copies stay as a second safety net.
- **Failures are sorted into what a person can do**: no connection (try again), signature (try again, download manually), not enough disk space. Automatic checks that fail
  stay silent; only a download the user started reports a failure.
- **Release notes come from the release page**: the update window sorts `### New / Improved / Fixed` bullets; free text just links to the page.
- **Local builds are unaffected**: update packages (`createUpdaterArtifacts`) are only turned on by the release workflow for a tag (`tauri.release.conf.json`), because they need the private key.

## Verified

Unit tests (state mapping, notice texts, persisted file, release-note parsing, time formatting), Playwright (Settings page in all states, cards, restart dialog,
deep link from the tray), and a real update on macOS with a throwaway key: an old bundle found, downloaded, verified and installed a newer bundle served from a local
server and restarted as the new version (log: `update check -> Available`, `update state -> Ready`, `installing and restarting`; the app came back as 0.1.1). The test also found a start-up crash that only builds with a public key had (the tray read the updater's state before it was created); the order in `setup` is fixed and the test builds ran with the key. Not verified here: Windows (the NSIS installer path), an update from the published release.
