#!/usr/bin/env bash
# restore_from_downloads.command — restore aceman favourites from a backup
# folder in your Mac Downloads (made by backup_to_downloads.command) back into
# the guest. Counterpart to wsl/restore_from_downloads.bat. Runs
# restore_from_downloads.sh inside the Lima guest against your Mac Downloads.
# With no argument it restores the newest aceman-backup-* folder there.
set -euo pipefail

DL="$HOME/Downloads"
# Guard the clone + script (the Mac kit and in-guest clone update separately)
# and run via `bash <script>` so we don't depend on the clone's exec bit. ARG is
# expanded Mac-side; the guest gets it single-quoted.
ARG="${1:-}"
limactl shell aceman -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - nothing to restore into.'; exit 0; }; if [ -f restore_from_downloads.sh ]; then ACE_DOWNLOADS='$DL' bash restore_from_downloads.sh '$ARG'; else echo 'aceman: restore_from_downloads.sh is missing from your guest clone (it predates this feature). Run update.command to refresh the clone, then retry.'; fi"
echo
read -r -p "Press Enter to close." _
