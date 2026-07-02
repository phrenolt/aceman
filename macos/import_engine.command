#!/usr/bin/env bash
# import_engine.command — find the Ace Stream engine tarball in your Mac
# Downloads and install it into the guest clone as engine.tar.gz. Counterpart
# to wsl/import_engine.bat. Runs import_engine.sh inside the Lima guest against
# your Mac Downloads (mounted into the guest by lima.yaml). If the tarball
# isn't there yet, the script prints the download URL and WAITS — download it
# in your browser, then press Enter in this window to finish.
set -euo pipefail

DL="$HOME/Downloads"
# Guard the clone + script (the Mac kit and in-guest clone update separately)
# and run via `bash <script>` so we don't depend on the clone's exec bit.
limactl shell aceman -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - is the guest provisioned? Run install.command first.'; exit 0; }; if [ -f import_engine.sh ]; then ACE_DOWNLOADS='$DL' bash import_engine.sh; else echo 'aceman: import_engine.sh is missing from your guest clone (it predates this feature). Run update.command to refresh the clone, then retry.'; fi"
echo
read -r -p "Press Enter to close." _
