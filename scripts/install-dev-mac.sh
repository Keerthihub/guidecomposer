#!/usr/bin/env bash
# Loads this working copy into Illustrator and InDesign as an unsigned development extension (macOS).
#
#   scripts/install-dev-mac.sh              install (symlink + enable debug mode)
#   scripts/install-dev-mac.sh --uninstall  remove the symlink
#
# PlayerDebugMode lets Illustrator load unsigned extensions. It applies to every
# CEP extension on this Mac user account. Turn it off when you are done testing:
#   defaults delete com.adobe.CSXS.12 PlayerDebugMode   (repeat for 11 and 13)
set -euo pipefail

ID="com.mullion.panel"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
LINK="$EXT_DIR/$ID"

if [[ "${1:-}" == "--uninstall" ]]; then
    if [[ -L "$LINK" ]]; then
        rm "$LINK"
        echo "Removed $LINK"
    else
        echo "Nothing to remove at $LINK"
    fi
    exit 0
fi

# CSXS 11 = Illustrator 2022, 12 = Illustrator 2023-2026. 13 is set for future versions.
for version in 11 12 13; do
    defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1
done

mkdir -p "$EXT_DIR"
if [[ -e "$LINK" && ! -L "$LINK" ]]; then
    echo "A folder already exists at $LINK and is not a symlink. Move it away and run this again." >&2
    exit 1
fi
ln -sfn "$ROOT" "$LINK"

echo "Linked $LINK -> $ROOT"
echo "Restart Illustrator or InDesign, then open Window > Extensions > Mullion."
