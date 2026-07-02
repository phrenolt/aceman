#!/usr/bin/env python3
"""Engine gateway — a transparent TCP splice that fronts the acestream
engine and REFUSES browser-originated requests.

Why this exists
---------------
The engine's HTTP API sets permissive CORS (``Access-Control-Allow-Origin: *``,
and it reflects the request Origin with credentials). Because it listens on
loopback, any website open in your browser can drive it: the page's JS runs
on your machine, so ``fetch('http://127.0.0.1:6878/…')`` hits your own engine,
and the open CORS even lets the site read the replies. We can't change the
engine's headers (proprietary), so we gate the door instead.

How it gates
------------
Browsers ALWAYS send the ``Sec-Fetch-Site`` request header (Fetch Metadata —
Firefox 90+, all Chromium), and page JS cannot set or remove it (it's a
forbidden header). Native clients — VLC, mpv, curl, the aceman CLI, the
broker — never send it. So we peek the first request's headers and drop the
connection if ``Sec-Fetch-Site`` is present: every browser is blocked, every
real player passes.

Everything after that one check is a raw byte splice in both directions, so
live MPEG-TS, chunked transfer, Range/seek, and keep-alive all pass through
untouched — the gateway never parses the stream, so it can't corrupt it.

Runs as its own container (reusing the web image) on the shared podman
network: it publishes the host port and forwards to the engine over the
bridge. Knobs are env vars (validated at boot):

  GW_LISTEN_HOST   host/interface to bind        (default 127.0.0.1)
  GW_LISTEN_PORT   port to listen on             (default 6878)
  GW_UPSTREAM_HOST engine host (bridge name)     (default ace)
  GW_UPSTREAM_PORT engine port                   (default 6878)
"""

from __future__ import annotations

import os
import socket
import sys
import threading

LISTEN_HOST = os.environ.get("GW_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("GW_LISTEN_PORT", "6878"))
UPSTREAM_HOST = os.environ.get("GW_UPSTREAM_HOST", "ace")
UPSTREAM_PORT = int(os.environ.get("GW_UPSTREAM_PORT", "6878"))

# Cap + deadline on the initial header read so a connection that dribbles
# (or never completes) headers can't hang a worker or smuggle past the gate.
MAX_HEADER_BYTES = 16 * 1024
HEADER_TIMEOUT = 10.0
CONNECT_TIMEOUT = 10.0
SPLICE_CHUNK = 64 * 1024

_FORBIDDEN = (
    b"HTTP/1.1 403 Forbidden\r\n"
    b"Content-Type: text/plain; charset=utf-8\r\n"
    b"Content-Length: 34\r\n"
    b"Connection: close\r\n"
    b"\r\n"
    b"blocked: engine not for browsers\n"
)
_BAD_REQUEST = (
    b"HTTP/1.1 400 Bad Request\r\n"
    b"Content-Length: 0\r\n"
    b"Connection: close\r\n"
    b"\r\n"
)


def _read_headers(conn: socket.socket) -> "bytes | None":
    """Read up to the end of the HTTP request headers (CRLF CRLF). Returns
    the raw header bytes (which we replay to the upstream), or None if the
    client sent something oversize / malformed / nothing in time."""
    conn.settimeout(HEADER_TIMEOUT)
    buf = b""
    try:
        while b"\r\n\r\n" not in buf:
            if len(buf) > MAX_HEADER_BYTES:
                return None
            chunk = conn.recv(4096)
            if not chunk:
                return None  # client closed before completing the request
            buf += chunk
    except (socket.timeout, OSError):
        return None
    return buf


def _has_sec_fetch_site(headers: bytes) -> bool:
    """True iff a ``Sec-Fetch-Site`` request header is present — our signal
    that the client is a browser. Header names are case-insensitive; we only
    scan the request-header block (already bounded by _read_headers)."""
    for line in headers.split(b"\r\n"):
        name, sep, _ = line.partition(b":")
        if sep and name.strip().lower() == b"sec-fetch-site":
            return True
    return False


def _splice(src: socket.socket, dst: socket.socket) -> None:
    """Copy bytes src→dst until EOF, then half-close dst's write side so the
    peer sees the stream end. Errors (peer reset mid-stream) end the copy."""
    try:
        while True:
            data = src.recv(SPLICE_CHUNK)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def _handle(client: socket.socket, addr) -> None:
    try:
        headers = _read_headers(client)
        if headers is None:
            client.sendall(_BAD_REQUEST)
            return
        if _has_sec_fetch_site(headers):
            # A browser. The engine is never meant to be reached from a
            # browser (the web UI uses the bridge, not this port), so refuse.
            client.sendall(_FORBIDDEN)
            return
        try:
            upstream = socket.create_connection(
                (UPSTREAM_HOST, UPSTREAM_PORT), timeout=CONNECT_TIMEOUT)
        except OSError:
            client.sendall(_BAD_REQUEST)
            return
        # No read timeout from here on: a live stream can idle between
        # chunks, and the splice must not kill it.
        client.settimeout(None)
        upstream.settimeout(None)
        with upstream:
            upstream.sendall(headers)            # replay the buffered request
            t = threading.Thread(target=_splice, args=(client, upstream),
                                 daemon=True)
            t.start()
            _splice(upstream, client)            # stream the response back
            t.join()
    except OSError:
        pass
    finally:
        try:
            client.close()
        except OSError:
            pass


def main() -> int:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(128)
    print(f"engine-gateway: {LISTEN_HOST}:{LISTEN_PORT} → "
          f"{UPSTREAM_HOST}:{UPSTREAM_PORT} (blocking browser requests)",
          flush=True)
    try:
        while True:
            conn, addr = srv.accept()
            threading.Thread(target=_handle, args=(conn, addr),
                             daemon=True).start()
    except KeyboardInterrupt:
        return 0
    finally:
        srv.close()


if __name__ == "__main__":
    sys.exit(main())
