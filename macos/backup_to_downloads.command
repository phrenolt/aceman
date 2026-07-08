#!/usr/bin/env bash
# backup_to_downloads.command — save aceman favourites to your Mac Downloads
# before uninstalling. Counterpart to wsl/backup_to_downloads.bat. Runs
# backup_to_downloads.sh inside the Lima guest, pointed at your Mac Downloads:
# the favourites live in the guest (~/.config/aceman), but Downloads is on
# macOS, which lima.yaml mounts writable into the guest at the same path.
# uninstall.command calls this (prompted); also runnable on its own.
set -euo pipefail

DL="$HOME/Downloads"
# Guard the clone + script: the Mac kit and the in-guest git clone update
# separately, so a fresh .command can meet an old clone that predates this
# script. Run via `bash <script>` (no dependence on the clone's exec bit), and
# skip cleanly with exit 0 rather than a confusing "No such file" error — this
# is called mid-teardown by uninstall.command.
limactl shell aceman -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - skipping backup.'; exit 0; }; if [ -f backup_to_downloads.sh ]; then ACE_DOWNLOADS='$DL' bash backup_to_downloads.sh; else echo 'aceman: backup_to_downloads.sh is missing from your guest clone (it predates this feature). Run update.command to refresh the clone, then retry. Skipping backup.'; fi"

# Any arg (uninstall.command passes "nopause") skips the prompt so the caller
# keeps control; a plain double-click waits so the result stays on screen.
if [ -z "${1:-}" ]; then
    echo
    read -r -p "Press Enter to close." _
fi
