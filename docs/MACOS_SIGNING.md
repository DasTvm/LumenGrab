# Signing the macOS build (Developer ID and notarization)

Why: an unsigned build (what the release workflow makes without these secrets) is only known to macOS by the hash
of its file. On some Macs the Screen Recording switch then looks on but is not honoured (the permission window keeps
coming back), and Gatekeeper warns on the first launch. A build signed with a **Developer ID Application**
certificate and notarized by Apple has a stable identity: the permission sticks, also across updates, and there is
no Gatekeeper warning.

## Is the private Apple account exposed?

No. The certificate and the passwords live only in **GitHub Actions secrets** of this repository:

- Secrets are encrypted, are never shown in the repository, the code or the logs (GitHub masks them), and cannot be
  read by anyone who only reads or forks the public repo. Workflows started from forks and pull requests of other
  people do not get them. The release workflow runs only on a tag or by hand, by someone with write access.
- What is public is only what any signed app shows: the name on the certificate and the Team ID (visible with
  `codesign -dv`). Nobody can use the account with that.
- Create a certificate and an app-specific password just for this, so that they can be revoked without touching
  anything else (developer.apple.com > Certificates, and appleid.apple.com > App-Specific Passwords).

## Setup (once)

1. **Certificate.** developer.apple.com > Certificates, Identifiers & Profiles > Certificates > `+` >
   **Developer ID Application** (the account holder can do this). Follow the steps with a Certificate Signing
   Request from Keychain Access (Certificate Assistant > Request a Certificate from a Certificate Authority, saved to disk).
   Download the `.cer` and double-click it so it is in your login keychain.
2. **Export.** Keychain Access > My Certificates > the "Developer ID Application: ..." entry (with its private key) >
   right click > Export... > `.p12` with a password you choose.
3. **Encode it:** `base64 -i certificate.p12 | pbcopy` (the text is in your clipboard).
4. **App-specific password** for notarization: appleid.apple.com > Sign-In and Security > App-Specific Passwords.
5. **GitHub secrets** (repository > Settings > Secrets and variables > Actions > New repository secret):

| Secret                       | Value                                                               |
| ---------------------------- | ------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | the base64 text of the `.p12`                                       |
| `APPLE_CERTIFICATE_PASSWORD` | the password of the `.p12`                                          |
| `APPLE_SIGNING_IDENTITY`     | the full name, e.g. `Developer ID Application: Your Name (TEAMID)`  |
| `APPLE_ID`                   | the Apple ID e-mail of the account                                  |
| `APPLE_PASSWORD`             | the app-specific password from step 4                               |
| `APPLE_TEAM_ID`              | the 10 character Team ID (developer.apple.com > Membership details) |

6. Delete the `.p12` and the base64 text from your Mac (the certificate stays in the keychain).

## What happens then

`.github/workflows/release.yml` looks for `APPLE_CERTIFICATE`. If it is there, the macOS build is signed with the
hardened runtime and sent to Apple for notarization (a few minutes), and the DMG and the update package are stapled.
If it is not there, the build is unsigned as before. Windows is unaffected (no free Windows signing exists).

Run the workflow by hand once (Actions > Release > Run workflow) and install the DMG artifact on a clean Mac to check:
`codesign -dv --verbose=4 /Applications/LumenGrab.app` shows the Team ID, and `spctl -a -vv /Applications/LumenGrab.app`
says `accepted, source=Notarized Developer ID`.

## Until then

The permission window offers `tccutil reset ScreenCapture app.lumengrab` (Terminal) for a Mac where the switch is on
but ignored. The capture code also asks ScreenCaptureKit directly when the system's preflight says no.
