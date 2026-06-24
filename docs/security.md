# Threat model

The Ace Stream engine is treated as an **untrusted input source**. Its
HTTP responses are size-capped, JSON-parsed strictly, URL-validated
(scheme forced to `http`, authority rewritten to the engine endpoint we
configured), and control bytes are scrubbed before anything is shown to
the user. The container runs with `cap-drop=ALL`, `no-new-privileges`, a
read-only rootfs, tmpfs scratch, memory + PID caps, and a
**loopback-only** port binding (no inbound NAT punch-through). See
[`container/engine/README.md`](../container/engine/README.md).

`search-ace.stream` is treated identically: server-side proxy,
HTTPS-only, allow-listed host, no off-domain redirects, JSON re-projected
into a minimal `{cid, name, translated_name}` shape with control-byte and
Unicode bidi-override stripping on names.

The **broker** is the host trust boundary: the web frontend can only ask
for a fixed allow-list of actions over a `0600` unix socket, and every
`podman` argv is hardcoded with the container name / image tag frozen at
startup — no request field reaches a command line. See
[`broker/README.md`](../broker/README.md).

## What it does not protect against

The container limits the blast radius **if** the engine binary
misbehaves, but does **not** protect against P2P deanonymisation — the
swarm sees your IP. For that, pair the engine with a VPN egress sidecar
(e.g. Gluetun) and disable UPnP on your router so the engine can't punch
its own inbound hole.
