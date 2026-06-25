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

> **Buffer = Off does *not* mean zero.** At 0 the slider passes **no**
> caching flag, so the external player falls back to its **own** saved
> setting — e.g. VLC's *Network caching* preference (which may be 30 s if
> you've set that), not 0. Off means "don't override the player," not "no
> buffer." To force a specific cushion, set the slider above 0; to truly
> minimise, also lower the player's own caching.

### A caveat for *live* streams (mpv differs)

A buffer is built one of two ways: **read ahead** of the playhead, or
**hold the playhead behind** the live edge. They behave very differently on
live P2P streams, where the only data ahead of "now" is whatever the engine
has already produced (a few seconds):

- **In-browser player** and **VLC** build the cushion by *holding back /
  adding latency* (`--network-caching` makes VLC play behind live). They get
  the **full** buffer you set, even on live.
- **mpv** only *reads ahead* (`--demuxer-readahead-secs`) and keeps playing
  at the live edge — so on a **live** stream its cache caps at the engine's
  serve-ahead window (~seconds) no matter how high you set the buffer. The
  flags are correct; the future data simply doesn't exist yet to read.

So **mpv will not produce the same live cushion as the browser or VLC.** On
**seekable** content (`.acelive` recordings, transport URLs) all three fill
to the value you set — the limit is specific to *live*. If a large live
cushion matters, prefer the **browser player** or **VLC**.

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
