#!/usr/bin/env bash
# Run the engine gateway: a transparent TCP splice (web/engine_gateway.py)
# that fronts the acestream engine and refuses browser-originated requests
# (any request carrying Sec-Fetch-Site). It is the ONLY host-published door
# to the engine in the default (gateway) mode — the engine itself stays on
# the shared bridge with no host port. See README "Security note".
#
# Reuses the web image (it already ships our Python + the module) — no new
# image to build. Joined to the shared podman network so it can reach the
# engine container over the bridge.
#
# Knobs (env vars, all optional):
#   ACE_GW_NAME      container name            (default ace-gw)
#   ACE_GW_HOST      host bind for the port    (default 127.0.0.1, EXCEPT
#                                                under WSL where it defaults
#                                                to 0.0.0.0 so the guest IP
#                                                answers; set 0.0.0.0 for LAN
#                                                exposure — the gateway still
#                                                blocks browsers on the LAN)
#   ACE_GW_PORT      host+container port        (default 6878)
#   ACE_NAME         upstream engine container  (default ace)
#   ACE_WEB_IMAGE    image to run               (default localhost/aceman-web:vetted)
#   ACE_NETWORK      shared bridge              (default aceman-net)
#   ACE_DETACH=1     run with -d (background)

set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROG="run-gateway.sh"
. "$_SCRIPT_DIR/../../shared/container/lib.sh"
ACELIB_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
ACE_NETWORK="${ACE_NETWORK:-aceman-net}"
ensure_shared_network

GW_NAME="${ACE_GW_NAME:-ace-gw}"
GW_PORT="${ACE_GW_PORT:-6878}"
UPSTREAM_NAME="${ACE_NAME:-ace}"
WEB_IMAGE="${ACE_WEB_IMAGE:-localhost/aceman-web:vetted}"

# Host bind default: loopback everywhere except WSL. The WSL branch exists
# to keep wsl/get_url_stream.bat working: that script runs `aceman <id>` in
# the guest and hands the stream URL — rewritten to the WSL guest IP — to
# Windows VLC/mpv. Windows can only reach that guest IP if the gateway (the
# sole host door to the engine) binds it, because 127.0.0.1 inside WSL2
# isn't routable from Windows. Same rule/override as run-container.sh:
# ACE_GW_HOST=127.0.0.1 forces loopback, ACE_DISABLE_WSL=1 treats WSL as
# plain Linux. The Sec-Fetch-Site gate still blocks browsers either way.
if is_wsl && [ "${ACE_DISABLE_WSL:-0}" != 1 ]; then
    GW_HOST="${ACE_GW_HOST:-0.0.0.0}"
else
    GW_HOST="${ACE_GW_HOST:-127.0.0.1}"
fi

# The gateway reuses the web image. In container mode the wrapper already
# built it; in --native mode it may be absent, so build it on demand
# (ensure_web_image honours ACE_WEB_IMAGE) — the gateway must be a
# container either way to reach the engine over the rootless bridge.
if ! podman image exists "$WEB_IMAGE"; then
    ensure_web_image
fi

validate_port "$GW_PORT" "ACE_GW_PORT"
case "$GW_HOST" in
    0.0.0.0|127.0.0.1|::1) ;;
    [0-9]*\.[0-9]*\.[0-9]*\.[0-9]*) ;;
    *) echo "$PROG: ACE_GW_HOST must be an IPv4 (or ::1), got: $GW_HOST" >&2; exit 1 ;;
esac

# Replace any prior instance.
podman rm -f "$GW_NAME" >/dev/null 2>&1 || true

detach_flag=()
[ "${ACE_DETACH:-0}" = "1" ] && detach_flag=(-d)

# Pure socket relay: no filesystem writes, no caps, tight memory/pids. It
# listens on 0.0.0.0 INSIDE the container; the host publish (GW_HOST) is
# what actually controls reachability (loopback by default).
exec podman run --rm "${detach_flag[@]}" \
    --name "$GW_NAME" \
    --network "$ACE_NETWORK" \
    -p "${GW_HOST}:${GW_PORT}:${GW_PORT}" \
    --cap-drop=ALL \
    --security-opt no-new-privileges \
    --read-only \
    --tmpfs /tmp:rw,size=8m,mode=1777 \
    --memory 128m \
    --pids-limit 64 \
    -e GW_LISTEN_HOST=0.0.0.0 \
    -e GW_LISTEN_PORT="$GW_PORT" \
    -e GW_UPSTREAM_HOST="$UPSTREAM_NAME" \
    -e GW_UPSTREAM_PORT=6878 \
    "$WEB_IMAGE" \
        python3 web/engine_gateway.py
