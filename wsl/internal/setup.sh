#!/usr/bin/env bash
set -euo pipefail

# ---- config ----
NEWUSER="ace"                                          # your Linux username
REPO="https://github.com/curiousconcept/aceman.git"    # HTTPS = no SSH key needed

echo ">> creating user $NEWUSER"
if ! id "$NEWUSER" &>/dev/null; then
    useradd -m -s /bin/bash "$NEWUSER"
    usermod -aG sudo "$NEWUSER"
    # passwordless sudo so the rest is hands-off
    echo "$NEWUSER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$NEWUSER
fi
# /etc/wsl.conf:
#   [boot] systemd=true  -> gives rootless podman a systemd user slice so the
#                           cgroup v2 memory controller is delegated; without
#                           it `podman stats` (and the aceman web mem readout)
#                           report 0 in WSL. Takes effect after `wsl --shutdown`.
#   [user] default        -> log in as this user instead of root.
printf '[boot]\nsystemd=true\n\n[user]\ndefault=%s\n' "$NEWUSER" > /etc/wsl.conf

echo ">> installing dependencies"
apt-get update -y
apt-get upgrade -y
apt-get install -y podman git jq

echo ">> cloning repo"
sudo -u "$NEWUSER" bash -lc "
    mkdir -p ~/Projects &&
    cd ~/Projects &&
    [ -d aceman ] || git clone $REPO
"

echo ">> provisioning complete"
