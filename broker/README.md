# Broker (`broker/`)

The host-side allow-list. The web frontend never talks to `podman`
directly — it sends one JSON line per action over a unix socket to this
broker process, which runs a fixed set of hardcoded `podman` argvs.

## Allow-list

```
engine.start | engine.stop  | engine.status
image.install | image.remove | image.status
desktop.* | players.* | browsers.* | web.* (web lifecycle)
```

For each action the broker runs a hardcoded argv. Container name and
image tag are read from env **at broker startup and frozen** — no field
from a request ever reaches the command line.

## Socket

```
$XDG_RUNTIME_DIR/aceman/broker.sock   # mode 0600, inside the 0700 runtime dir
```

Only your own UID can open it.

## No install step

The `aceman_web` wrapper auto-spawns the broker on launch if its socket
isn't there, using `setsid -f` so the broker outlives the wrapper and
serves later launches in the same user session. Crashes self-heal on the
next run. For debugging, run it directly so stderr is visible:

```bash
./broker/aceman-broker
```

## Environment

Read once at broker startup; export before the first launch to override.

| Var               | Default                      | Notes                                          |
|-------------------|------------------------------|------------------------------------------------|
| `ACE_NAME`        | `ace`                        | Container name the broker manages.             |
| `ACE_IMAGE`       | `localhost/acestream:vetted` | Image tag the broker builds and runs.          |
| `ACE_ENGINE_URL`  | `http://127.0.0.1:6878`      | Engine HTTP API for the `engine.status` probe. |
| `ACE_PROJECT_ROOT`| auto-detected from script    | Build context root + location of `container/`. |

If the broker isn't running, the web UI shows a "broker not running"
message on the engine/image cards and keeps working for everything else
(search, favourites, settings). The host `aceman` shell doesn't use the
broker — it's already trusted user code and talks to `podman` directly.

## Layout

```
broker/
├── aceman-broker            # entrypoint script
├── aceman_broker/           # package
│   ├── actions/             # one file per action group
│   ├── server.py            # unix-socket dispatcher
│   ├── validators.py        # host/port/size validators
│   └── …                    # desktop_template, mimeapps, paths, flatpak
└── tests/                   # unittest suite
```

See [`docs/security.md`](../docs/security.md) for the trust boundary
rationale.
