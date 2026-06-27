# Engine image (`engine/container/`)

The Ace Stream engine, inside a locked-down rootless Podman container.
Everything for this image lives here: the `Containerfile`, the `dist/`
tarball it copies, and the `run-container.sh` launcher.

## Provide the engine tarball

The Ace Stream Linux tarball is **not** in git — it's proprietary, so we
don't redistribute it. You download it yourself:

> **https://docs.acestream.net/products/#linux**

Pick the **Linux → Ubuntu, amd64 / py3.10** build (the exact filename and
version may change over time), e.g.:

```
acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz
  → save as engine/container/dist/engine.tar.gz
```

There is no upstream signature, so record your own SHA-256 and keep it.
The repo ships `engine.tar.gz.sha256` as the author's last-checked hash —
compare yours against it to confirm you grabbed the same build.

## Build

> Normally you don't build by hand — `aceman` / `aceman_web` build and
> cache images for you, labelled `aceman.commit=<sha>`.

```bash
mkdir -p engine/container/dist
mv engine.tar.gz engine/container/dist/
sha256sum engine/container/dist/engine.tar.gz | tee engine/container/dist/engine.tar.gz.sha256
podman build -t localhost/acestream:vetted \
    -f engine/container/Containerfile engine/container
```

Build context is `engine/container/` itself, so `COPY dist/engine.tar.gz`
resolves locally. `.containerignore` (at the project root) keeps the
context small and the layer cache stable. The aceman-web image has the
same shape under `web/container/`.

## Run

```bash
./engine/container/run-container.sh
```

Foreground; Ctrl-C stops it.

### Environment variables

All knobs apply to direct invocations of `run-container.sh`. When
`aceman` / `aceman_web` start the engine for you they set these
themselves (notably `ACE_DETACH=1`).

| Var              | Default                      | Meaning                                                              |
|------------------|------------------------------|----------------------------------------------------------------------|
| `ACE_IMAGE`      | `localhost/acestream:vetted` | Image tag.                                                           |
| `ACE_NAME`       | `ace`                        | Container name.                                                      |
| `ACE_API_PORT`   | `6878`                       | Loopback-bound host port for the HTTP API. (Alias: `ACE_PORT`.)     |
| `ACE_MEMORY`     | `5g`                         | `--memory` cap on the container.                                    |
| `ACE_CACHE_SIZE` | `3g`                         | `--tmpfs` size for `/home/ace/.ACEStream`; engine self-evicts at ~90 %. |
| `ACE_DETACH`     | `0`                          | `1` adds `-d` (background) and returns immediately.                 |
| `ACE_BLOCK_TELEMETRY` | `0`                     | `1` null-routes Ace Stream's stats/telemetry hosts. **Off by default** — see note below. |

### Hardening

`run-container.sh` applies: `--cap-drop=ALL`,
`--security-opt no-new-privileges`, `--read-only`, tmpfs for `/tmp` and
`/home/ace/.ACEStream`, and memory/PID caps. See
[`docs/security.md`](../../docs/security.md) for the full threat model.

### Telemetry blocking is opt-in

By **default the engine is allowed to reach Ace Stream's stats/telemetry
hosts** — Ace Stream's User Agreement requires unhindered access to those
facilities, so the default keeps you on the compliant side. If you'd
rather block them, opt in explicitly:

```bash
ACE_BLOCK_TELEMETRY=1 ./engine/container/run-container.sh
```

(or export it before launching `aceman` / `aceman_web`). This null-routes
`stats.acestream.{net,media}` and `awstats.acestream.{net,media}`. It
improves privacy but may conflict with Ace Stream's terms — enabling it is
your deliberate choice.
