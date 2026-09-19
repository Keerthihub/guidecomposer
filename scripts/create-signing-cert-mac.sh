#!/usr/bin/env bash
# Creates GuideComposer's long-lived self-signed ZXP certificate.
#
# Usage:
#   scripts/create-signing-cert-mac.sh <country-code> <state-or-province>
#
# The password is entered privately and is never written by this script. Save it
# in a password manager immediately. The certificate is deliberately created
# outside the repository.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COUNTRY="${1:-}"
STATE="${2:-}"
SIGNER="${ZXPSIGNCMD:-/Users/keerthismac/Tools/Adobe-ZXPSignCmd-4.1.1/ZXPSignCmd}"
CERT_DIR="${GUIDECOMPOSER_CERT_DIR:-/Users/keerthismac/Documents/GuideComposer Signing}"
CERT="$CERT_DIR/guidecomposer-signing.p12"

if [[ -z "$COUNTRY" || -z "$STATE" ]]; then
    echo "Usage: $0 <two-letter-country-code> <state-or-province>" >&2
    exit 2
fi
if [[ ! "$COUNTRY" =~ ^[A-Za-z]{2}$ ]]; then
    echo "Country code must contain exactly two letters, such as IN or US." >&2
    exit 2
fi
if [[ ! -x "$SIGNER" ]]; then
    echo "Adobe ZXPSignCmd is not executable at: $SIGNER" >&2
    echo "Set ZXPSIGNCMD to the verified binary path and try again." >&2
    exit 1
fi
case "$CERT_DIR" in
    "$ROOT"|"$ROOT"/*)
        echo "The signing certificate must stay outside the repository." >&2
        exit 1
        ;;
esac
if [[ -e "$CERT" ]]; then
    echo "Refusing to overwrite the existing lifetime certificate: $CERT" >&2
    exit 1
fi

read -r -s -p "Create a strong certificate password: " PASSWORD
echo
read -r -s -p "Enter it again: " CONFIRM
echo
if [[ -z "$PASSWORD" ]]; then
    echo "The certificate password cannot be empty." >&2
    exit 1
fi
if [[ "$PASSWORD" != "$CONFIRM" ]]; then
    echo "The passwords did not match; nothing was created." >&2
    exit 1
fi

mkdir -p "$CERT_DIR"
"$SIGNER" -selfSignedCert \
    "${COUNTRY^^}" "$STATE" "Keerthihub" "GuideComposer ZXP Signing" \
    "$PASSWORD" "$CERT" -validityDays 3650
chmod 600 "$CERT"
unset PASSWORD CONFIRM

echo
echo "Created: $CERT"
echo "Back up this file and save its password in a password manager now."
echo "Never commit it. Use the same certificate for every GuideComposer release."
echo
echo "After the GitHub repository exists, add these Actions secrets:"
echo "  ZXP_CERT_BASE64    base64 -i '$CERT' | pbcopy"
echo "  ZXP_CERT_PASSWORD  the password you just saved"
