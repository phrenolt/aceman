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
# make this the default WSL user
printf '[user]\ndefault=%s\n' "$NEWUSER" > /etc/wsl.conf

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
