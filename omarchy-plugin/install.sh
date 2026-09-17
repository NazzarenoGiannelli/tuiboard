#!/bin/bash
# Installs the tuiboard Omarchy bar widget from this checkout.
#
# `omarchy plugin add <git-url>` clones a git repo and expects manifest.json
# at its root — it has no notion of a plugin living in a subfolder of a
# larger repo, which is what this is. There is also no official Omarchy
# plugin marketplace to fetch from (`omarchy plugin catalog` only lists
# what's already installed locally). So instead of `add`, this symlinks the
# plugin folder into place directly; `find -L` in Omarchy's own catalog
# script already follows symlinks, so the plugin is discovered exactly like
# a normal install and `omarchy plugin update` is just `git pull` here.

set -euo pipefail

PLUGIN_ID="nazz.tuiboard"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins"
TARGET="$PLUGINS_DIR/$PLUGIN_ID"

command -v omarchy >/dev/null 2>&1 || {
  echo "install.sh: omarchy CLI not found — this plugin only works on Omarchy." >&2
  exit 1
}

if [[ -L "$TARGET" && "$(readlink -f "$TARGET")" == "$(readlink -f "$SRC_DIR")" ]]; then
  echo "Already installed and pointing here: $TARGET"
elif [[ -e "$TARGET" || -L "$TARGET" ]]; then
  echo "install.sh: $TARGET already exists and isn't this checkout." >&2
  echo "Remove it first: omarchy plugin remove $PLUGIN_ID" >&2
  exit 1
else
  mkdir -p "$PLUGINS_DIR"
  ln -s "$SRC_DIR" "$TARGET"
  echo "Linked $TARGET -> $SRC_DIR"
fi

command -v omarchy-shell >/dev/null 2>&1 && omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true

if omarchy plugin enable "$PLUGIN_ID" right >/dev/null 2>&1; then
  echo "Enabled $PLUGIN_ID in the right bar section."
else
  echo "Installed but not enabled yet. Run: omarchy plugin enable $PLUGIN_ID right"
fi
