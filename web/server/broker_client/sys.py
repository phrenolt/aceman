"""Host CPU / GPU utilisation facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class SysBrokerClient:
    """Queries the host broker for live CPU / GPU utilisation.

    Returned shape from ``usage()``:

        {
            "cpu": float | null,       # % busy, 10 s rolling average
            "gpu": float | null,       # % busy, 10 s average (null if unknown)
            "gpu_kind": "nvidia" | "amd" | "intel" | null,
            "window_secs": int,
        }
    """

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def usage(self) -> dict:
        return self.broker.call("sys.usage", timeout=8)
