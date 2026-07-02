#!/usr/bin/env bash
# Update aceman — counterpart to wsl/update.bat.
# Force-updates the guest clone: fetches GitHub and hard-resets to the latest
# code. Takes an optional branch argument (default: current branch, else main).
set -euo pipefail

BRANCH="${1:-}"

cat <<EOF
============================================================
 Update aceman
------------------------------------------------------------
 Force-updates the guest clone (~/Projects/aceman): fetches
 GitHub and hard-resets to the latest code. Any local edits to
 the repo are discarded. Your favourites are NOT in the repo
 (they live in the guest's ~/.config/aceman), so they are kept.
 Target branch: ${BRANCH:-current (or main)}

 TRUST NOTE: this pulls code from the internet that will run
 on your machine on the next launch. Only proceed if you trust
 the project author and have reviewed the repository:

     https://github.com/curiousconcept/aceman
============================================================
EOF

read -r -p "Update now (discards local repo edits)? [Y/N] " a
case "$a" in
    [Yy]*) ;;
    *) echo "Cancelled. Nothing changed."; exit 0 ;;
esac

echo
echo "Updating..."
# Force-pull inline via git, NOT by calling ./update.sh — update is the tool you
# run to escape a stale clone, so it must not depend on any file being in that
# clone (a clone old enough to lack update.sh is exactly when you need this).
# Mirrors update.sh: fetch, then hard-reset the branch to origin. $BRANCH is
# expanded Mac-side into the string; \$B / \$(...) stay literal for the guest.
if limactl shell aceman -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - run install.command first.'; exit 1; }; B='$BRANCH'; B=\${B:-\$(git rev-parse --abbrev-ref HEAD 2>/dev/null)}; case \$B in HEAD|'') B=main ;; esac; echo updating to origin/\$B ...; git fetch origin \$B && git reset --hard && git checkout -B \$B origin/\$B"; then
    echo "Update complete. Launch with run.command."
else
    echo "Update did not complete cleanly. Check your internet connection, or"
    echo "that the branch name is correct. Open the guest and look:"
    echo "    limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && git status'"
fi
