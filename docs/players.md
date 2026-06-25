# Buffering / cache settings

P2P live streams jitter — give the player a few seconds (or tens of
seconds) of cache so it rides that out instead of stalling at every blip.
Trade-off: higher cache = smoother playback but later to start. The
"nothing happens for a minute then it plays" feeling is exactly what 60 s
of network caching looks like.

> **The web UI's "Buffer" slider does this for you.** Setting it (e.g.
> 15 s) drives the in-tab browser player *and* — because the value is
> saved server-side as `config.json:buffer_secs` — the **external player**:
> the `aceman` CLI translates it into `--network-caching` (VLC) or
> `--cache-secs` (mpv) automatically, so you don't have to hunt through
> their menus. The manual flags below are only needed if you launch a
> player yourself, outside aceman.

> **Buffer = Off does *not* mean zero.** At 0 the slider sends **no**
> caching flag, so the external player keeps its **own** saved setting —
> e.g. VLC's *Network caching* (which may be 30 s if you set it), not 0.
> Off means "don't change the player's setting," not "no buffer." To set a
> specific buffer, move the slider above 0; to make it small, also lower
> the player's own caching.

### Live streams: mpv works differently

There are two ways to build a buffer: **load ahead** of where you're
watching, or **play a few seconds behind live**. On live P2P streams these
behave very differently, because the only data past "now" is the few
seconds the engine has already downloaded:

- **Browser player** and **VLC** play a few seconds behind live (for VLC,
  `--network-caching` adds that delay). They get the **full** buffer you
  set, even on live.
- **mpv** only loads ahead (`--demuxer-readahead-secs`) and keeps playing
  at the live point — so on a **live** stream its buffer can't go past the
  few seconds the engine has ready, no matter how high you set it. The
  flags are right; the data just isn't there yet to load.

So **mpv won't give the same live buffer as the browser or VLC.** On
**seekable** content (`.acelive` recordings, transport URLs) all three fill
to the value you set — this limit is live-only. For a big live buffer, use
the **browser player** or **VLC**.

## VLC

GUI path (where the *60 000 ms* setting lives):

> **Tools → Preferences → Show settings: All** *(bottom-left radio)* **→ Input / Codecs**

| Setting                  | What it covers                                       | Sensible range        |
|--------------------------|------------------------------------------------------|-----------------------|
| **Network caching (ms)** | HTTP, RTSP, etc. — what the Ace Stream engine serves | `5000`–`30000`        |
| **HTTP caching (ms)**    | HTTP specifically (per-protocol override)            | match Network caching |
| **Live caching (ms)**    | HLS / DVB / SDP live inputs                          | `5000`–`30000`        |
| Disc / File caching      | irrelevant for Ace Stream                            | leave defaults        |

Command-line equivalent (same flags work for the Flatpak):

```bash
vlc --network-caching=10000 --http-caching=10000 URL
flatpak run org.videolan.VLC -- --network-caching=10000 URL
```

## mpv

Put these in `~/.config/mpv/mpv.conf` (system install) or
`~/.var/app/io.mpv.Mpv/config/mpv/mpv.conf` (Flatpak):

```ini
cache=yes
cache-secs=20              # seconds buffered ahead of the play head
demuxer-readahead-secs=20  # how far ahead the demuxer fetches
demuxer-max-bytes=200MiB   # hard ceiling on cached data
```

Or one-shot:

```bash
mpv --cache=yes --cache-secs=20 URL
```
