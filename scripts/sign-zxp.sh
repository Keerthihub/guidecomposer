#!/usr/bin/env bash
# Builds dist/mullion and signs it into dist/mullion-<version>.zxp.
#
# Required environment:
#   ZXPSIGNCMD            path to Adobe's ZXPSignCmd binary
#   MULLION_CERT          path to your .p12 certificate (keep it outside the repository)
# Optional:
#   MULLION_CERT_PASSWORD certificate password; prompted for when unset
#   MULLION_TSA           timestamp server (default http://timestamp.digicert.com)
#
# Nothing here writes the certificate or password to disk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${ZXPSIGNCMD:?Set ZXPSIGNCMD to the ZXPSignCmd binary path}"
: "${MULLION_CERT:?Set MULLION_CERT to your .p12 certificate path}"
TSA="${MULLION_TSA:-http://timestamp.digicert.com}"

case "$(cd "$(dirname "$MULLION_CERT")" && pwd)" in
    "$ROOT"|"$ROOT"/*) echo "Keep the certificate outside the repository: $MULLION_CERT" >&2; exit 1 ;;
esac

if [[ -z "${MULLION_CERT_PASSWORD:-}" ]]; then
    read -r -s -p "Certificate password: " MULLION_CERT_PASSWORD
    echo
fi

VERSION="$(node -p "require('./package.json').version")"
OUT="dist/mullion-$VERSION.zxp"

npm run build
rm -f "$OUT"
"$ZXPSIGNCMD" -sign dist/mullion "$OUT" "$MULLION_CERT" "$MULLION_CERT_PASSWORD" -tsa "$TSA"
"$ZXPSIGNCMD" -verify "$OUT" -certinfo

echo "Signed $OUT"
