"""Android TV (VLC) casting facade over the broker socket.

The web never runs ``adb`` itself (containerised, no host adb / no LAN
path); it asks the host broker to connect to the box and launch VLC. The
wire carries only ``{ip}`` / ``{ip, cid}`` — the broker validates both and
builds the stream URL from its own LAN detection.
"""

from __future__ import annotations

from .base import BrokerClient


class TvBrokerClient:
    """Facade for the ``tv.connect`` / ``tv.cast`` broker actions.

    ``connect`` returns ``{"status": "authorized"|"unauthorized"|
    "unreachable"|"no-adb"|"invalid-ip"}`` so the UI can guide the one-time
    on-TV debugging approval. ``cast`` returns ``{"cast": bool, "status":
    ...}`` with the same status vocabulary on failure.
    """

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    # adb can be slow: the broker action may run `adb connect` (up to 20s) +
    # `adb devices` (up to 15s) + `adb shell` (up to 20s). Keep the client
    # timeout comfortably above that worst case so a slow/wedged adb surfaces
    # the action's own status ("unreachable"), not a generic broker timeout.
    _TIMEOUT = 60

    def connect(self, ip: str) -> dict:
        return self.broker.call(
            "tv.connect", params={"ip": ip}, timeout=self._TIMEOUT)

    def cast(self, ip: str, cid: str) -> dict:
        return self.broker.call(
            "tv.cast", params={"ip": ip, "cid": cid}, timeout=self._TIMEOUT)
