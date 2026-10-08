#!/usr/bin/env bash
# Creates a self-signed code-signing certificate "LumenGrab Local Dev" in the login keychain (macOS).
#
# Why: ad-hoc signed builds are identified by their exact binary hash, so macOS forgets the Screen
# Recording permission after every rebuild. Signing local test builds with ONE stable certificate keeps
# the identity (and the permission) the same across rebuilds. It is only for your own machine: it does
# not make the app trusted by anyone else, and release builds stay unsigned (AGENTS.md section 8).
#
# The private key never leaves the keychain: it is generated in a temp dir, imported, and deleted.
# Usage:  scripts/create-dev-signing-cert.sh
#         APPLE_SIGNING_IDENTITY="LumenGrab Local Dev" pnpm tauri build
set -euo pipefail

NAME="LumenGrab Local Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Certificate \"$NAME\" already exists in the login keychain. Nothing to do."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
pass="$(openssl rand -hex 16)"

cat > "$work/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/openssl.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$NAME" \
  -out "$work/id.p12" -passout "pass:$pass" 2>/dev/null

security import "$work/id.p12" -k "$KEYCHAIN" -P "$pass" -T /usr/bin/codesign >/dev/null
echo "Imported \"$NAME\". macOS now asks for your password once to trust it for code signing."
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$work/cert.pem"
echo "Done. Check with: security find-identity -v -p codesigning"
