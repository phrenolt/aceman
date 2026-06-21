"""GPU capability facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class GpuBrokerClient:
    """Queries the host broker for GPU availability (NVIDIA / VA-API / QSV).

    Returned shape from ``status()``:

        {
            "available": bool,
            "nvidia": {"name": str} | null,
            "vaapi":  {"device": str, "h264_enc": bool} | null,
            "qsv":    bool,
        }
    """

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def status(self) -> dict:
        return self.broker.call("gpu.status", timeout=10)
