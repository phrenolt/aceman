#!/usr/bin/env bash
# restore_from_downloads.sh — restore aceman favourites/prefs from a backup
# folder that backup_to_downloads.sh saved into Downloads, copying the files
# back into ~/.config/aceman. The reverse of backup_to_downloads.sh.
#
# Which backup: pass a path to an aceman-backup-… folder as the first
# argument, or with no argument the newest aceman-backup-* in Downloads is
# used (the timestamp in the name sorts chronologically).
#
# Downloads dir resolution: $ACE_DOWNLOADS (the WSL .bat points this at the
# Windows Downloads folder) → $XDG_DOWNLOAD_DIR → ~/Downloads.

set -u

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/aceman"
DOWNLOADS="${ACE_DOWNLOADS:-${XDG_DOWNLOAD_DIR:-$HOME/Downloads}}"

# Resolve the backup folder to restore from.
if [ "$#" -ge 1 ] && [ -n "$1" ]; then
    SRC="$1"
else
    SRC="$(find "$DOWNLOADS" -maxdepth 1 -type d -name 'aceman-backup-*' \
           2>/dev/null | sort | tail -1)"
fi

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
    echo "restore_from_downloads: no backup folder found." >&2
    echo "Looked in $DOWNLOADS for aceman-backup-*; or pass one as an argument." >&2
    exit 1
fi

# Which known files does this backup actually hold?
present=()
for f in favorites.db favorites config.json env; do
    [ -e "$SRC/$f" ] && present+=("$f")
done
if [ "${#present[@]}" -eq 0 ]; then
    echo "restore_from_downloads: $SRC holds no aceman files to restore." >&2
    exit 1
fi

echo "restore_from_downloads: restoring from $SRC"
echo "  files: ${present[*]}"
echo "  into:  $CONFIG_DIR"
echo
echo "This OVERWRITES your current favourites/prefs. Stop aceman first"
echo "(close the web UI) so a running instance doesn't overwrite the"
echo "restore when it exits."
printf 'Proceed? [y/N] '
read -r reply
case "$reply" in
    y|Y|yes|YES) : ;;
    *) echo "restore_from_downloads: cancelled — nothing changed."; exit 0 ;;
esac

if ! mkdir -p "$CONFIG_DIR"; then
    echo "restore_from_downloads: cannot create $CONFIG_DIR" >&2
    exit 1
fi
for f in "${present[@]}"; do
    cp "$SRC/$f" "$CONFIG_DIR/" && echo "  restored $f"
done
echo "restore_from_downloads: done. Relaunch aceman to see them."
