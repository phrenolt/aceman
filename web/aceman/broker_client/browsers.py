"""Browser-detection facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class BrowsersBrokerClient:
    """Host-introspection facade for installed browsers. Mirrors
    :class:`PlayersBrokerClient`. Each row carries an ``argv`` (without
    the URL) so the caller can spawn the browser without re-deriving
    the command line from ``{name, source}``. The web frontend uses
    only ``name`` and ``source`` for the UI; the launch helper uses
    ``argv``.

    Returned shape::

        {"platform": "linux"|"darwin"|"windows",
         "available": [{"name": "firefox", "source": "system"|"flatpak",
                        "argv": ["firefox"]}, ...]}
    """

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def list(self) -> dict:
        return self.broker.call("browsers.list", timeout=10)

    def spawn(self, name: str, source: str, url: str) -> dict:
        # The web server runs inside a container with no DISPLAY /
        # DBus / Wayland socket, so ``subprocess.Popen`` from here
        # can't actually open a GUI browser — the spawn lands in a
        # void. The broker, on the host, has the full session env;
        # ``browser.spawn`` is the only path that actually works for
        # acestream:// hand-offs in the containerised default mode.
        return self.broker.call(
            "browser.spawn",
            params={"name": name, "source": source, "url": url},
            timeout=10,
        )
