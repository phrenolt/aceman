# CLI: `aceman`

The host player-side. Talks to the engine's HTTP API, launches a local
player, and tracks favourites in a flat file.

```
aceman <content_id>          # 40-hex content id or acestream://<id>
aceman --url <transport_url>
aceman --infohash <infohash>
aceman --fav <name…>         # play a saved favourite (case-insensitive;
                             #   words after --fav are joined — no quotes)
aceman --list                # list saved favourites
```

## What it does

- Probes the engine. If unreachable, starts it via `ACE_DETACH=1
  ./run.sh` and polls up to 30 s.
- Calls `/ace/getstream?format=json`, validates URLs, launches the player.
- On exit, ends the *stream session* (`command_url?method=stop`). The
  *engine container* keeps running so channel-switching stays fast — a
  banner reminds you to `podman stop ace` to fully shut down.
- Default player is `vlc`; override with `ACE_PLAYER=mpv` or any binary
  that accepts a URL as a positional argument.
- After the player closes, prompts to save the stream as a favourite
  (skip with empty input). Suppressed when stdin isn't a TTY, when the
  stream came from a favourite, or when the cid is already saved.

## Favourites file

```
~/.config/aceman/favorites      # tab-separated  name<TAB>id
```

Blank lines and `#` comments are skipped. (The web app uses a separate
SQLite DB — see [`web/README.md`](../web/README.md).)

For player buffering/cache tuning, see [`players.md`](players.md).
