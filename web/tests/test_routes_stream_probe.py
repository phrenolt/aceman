"""Tests for the probe + unplayable-log routes.

Exercises the routes directly with a synthetic Request + RouteContext — the
probe orchestration and the store are stubbed (covered in test_probe.py /
test_unplayable_store.py). The routes' jobs: validate, shed load, pass the
deep flag through, and keep the failure log in sync (record failures, clear
recoveries).
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import unittest
import unittest.mock as mock

from server.context import RouteContext
from server.http_io import Request
from server.routes import stream_probe


ENGINE = "http://127.0.0.1:6878"
CID = "a" * 40


def _req(body=None, query=None):
    return Request(method="POST", path="/api/stream/probe",
                   body=body or {}, query=query or {}, path_params={})


def _result(state, reason=""):
    return {"cid": CID, "state": state, "detail": {"reason": reason}}


class StreamProbeRouteTests(unittest.TestCase):
    def test_rejects_bad_cid_before_engine(self):
        with mock.patch("server.routes.stream_probe.probe_stream") as ps:
            for bad in ({}, {"cid": "nope"}, {"cid": "a" * 39}, {"cid": 123}):
                with self.subTest(bad=bad):
                    resp = stream_probe.stream_probe(
                        _req(bad), RouteContext(engine=ENGINE))
                    self.assertEqual(resp.status, 400)
            ps.assert_not_called()

    def test_passes_cid_and_deep_flag(self):
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("healthy")) as ps:
            resp = stream_probe.stream_probe(
                _req({"cid": "A" * 40, "deep": True}), RouteContext(engine=ENGINE))
        self.assertEqual(resp.status, 200)
        ps.assert_called_once_with(ENGINE, CID, deep=True)
        self.assertEqual(json.loads(resp.body)["state"], "healthy")

    def test_deep_defaults_false(self):
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("healthy")) as ps:
            stream_probe.stream_probe(_req({"cid": CID}), RouteContext(engine=ENGINE))
        ps.assert_called_once_with(ENGINE, CID, deep=False)

    def test_deep_failure_is_logged(self):
        store = mock.Mock()
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("unplayable", "no video stream")):
            stream_probe.stream_probe(
                _req({"cid": CID, "deep": True, "name": " Chan A "}),
                RouteContext(engine=ENGINE, unplayable_store=store))
        store.record.assert_called_once_with(CID, "Chan A", "unplayable", "no video stream")
        store.delete.assert_not_called()

    def test_deep_recovery_clears_log(self):
        store = mock.Mock()
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("healthy")):
            stream_probe.stream_probe(
                _req({"cid": CID, "deep": True}),
                RouteContext(engine=ENGINE, unplayable_store=store))
        store.delete.assert_called_once_with(CID)
        store.record.assert_not_called()

    def test_shallow_probe_never_logs(self):
        store = mock.Mock()
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("dead")):
            stream_probe.stream_probe(
                _req({"cid": CID}),  # deep omitted
                RouteContext(engine=ENGINE, unplayable_store=store))
        store.record.assert_not_called()
        store.delete.assert_not_called()

    def test_verdict_cached_regardless_of_deep(self):
        # Every probe — even a shallow healthy one — updates the marker cache.
        cache = mock.Mock()
        cache.get.return_value = {"probed_at": "2026-07-09 21:00:00",
                                  "age_secs": 0, "state": "healthy",
                                  "detail": {"reason": ""}}
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("healthy")):
            resp = stream_probe.stream_probe(
                _req({"cid": CID}),  # shallow
                RouteContext(engine=ENGINE, probe_status_store=cache))
        cache.record.assert_called_once_with(CID, "healthy", {"reason": ""})
        body = json.loads(resp.body)
        self.assertFalse(body["cached"])
        self.assertEqual(body["probed_at"], "2026-07-09 21:00:00")

    def test_fresh_verdict_skips_engine(self):
        # A cached verdict within max_age_secs is returned without probing.
        cache = mock.Mock()
        cache.get.return_value = {"probed_at": "2026-07-09 21:00:00",
                                  "age_secs": 60, "state": "healthy",
                                  "detail": {"reason": ""}}
        with mock.patch("server.routes.stream_probe.probe_stream") as ps:
            resp = stream_probe.stream_probe(
                _req({"cid": CID, "max_age_secs": 300}),
                RouteContext(engine=ENGINE, probe_status_store=cache))
        ps.assert_not_called()                     # engine untouched
        cache.record.assert_not_called()
        body = json.loads(resp.body)
        self.assertTrue(body["cached"])
        self.assertEqual(body["state"], "healthy")

    def test_stale_verdict_reprobes(self):
        # Older than max_age_secs → probe again.
        cache = mock.Mock()
        cache.get.return_value = {"probed_at": "2026-07-09 20:00:00",
                                  "age_secs": 9999, "state": "dead",
                                  "detail": {"reason": ""}}
        with mock.patch("server.routes.stream_probe.probe_stream",
                        return_value=_result("healthy")) as ps:
            stream_probe.stream_probe(
                _req({"cid": CID, "max_age_secs": 300}),
                RouteContext(engine=ENGINE, probe_status_store=cache))
        ps.assert_called_once()                    # stale → re-probed

    def test_sheds_load_past_ceiling(self):
        sema = stream_probe._probe_sema
        acquired = []
        while sema.acquire(blocking=False):
            acquired.append(True)
        try:
            with mock.patch("server.routes.stream_probe.probe_stream") as ps:
                resp = stream_probe.stream_probe(
                    _req({"cid": CID}), RouteContext(engine=ENGINE))
                self.assertEqual(resp.status, 503)
                ps.assert_not_called()
        finally:
            for _ in acquired:
                sema.release()


class UnplayableLogRouteTests(unittest.TestCase):
    def _ctx(self, store):
        return RouteContext(engine=ENGINE, unplayable_store=store)

    def test_list(self):
        store = mock.Mock()
        store.list.return_value = [{"cid": CID, "state": "dead"}]
        resp = stream_probe.list_unplayable(_req(), self._ctx(store))
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.body)[0]["cid"], CID)

    def test_list_404_when_disabled(self):
        resp = stream_probe.list_unplayable(_req(), RouteContext(engine=ENGINE))
        self.assertEqual(resp.status, 404)

    def test_export_is_a_download(self):
        store = mock.Mock()
        store.list.return_value = [{"cid": CID, "state": "unplayable"}]
        resp = stream_probe.export_unplayable(_req(), self._ctx(store))
        self.assertEqual(resp.status, 200)
        cd = resp.extra_headers.get("Content-Disposition", "")
        self.assertIn("attachment", cd)
        self.assertIn(".json", cd)
        payload = json.loads(resp.body)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["channels"][0]["cid"], CID)
        self.assertIn("exported_at", payload)

    def test_clear(self):
        store = mock.Mock()
        resp = stream_probe.clear_unplayable(_req(), self._ctx(store))
        self.assertEqual(resp.status, 200)
        store.clear.assert_called_once()


class ProbeStatusRouteTests(unittest.TestCase):
    def test_lists_cached_verdicts(self):
        cache = mock.Mock()
        cache.list.return_value = [
            {"cid": CID, "state": "healthy", "detail": {}}]
        resp = stream_probe.probe_status(
            _req(), RouteContext(engine=ENGINE, probe_status_store=cache))
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.body)[0]["state"], "healthy")

    def test_empty_list_when_disabled(self):
        # No cache configured → empty list (not a 404), so the UI just starts
        # with no markers rather than erroring.
        resp = stream_probe.probe_status(_req(), RouteContext(engine=ENGINE))
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.body), [])

    def test_clear_probe_cache(self):
        cache = mock.Mock()
        resp = stream_probe.clear_probe_status(
            _req(), RouteContext(engine=ENGINE, probe_status_store=cache))
        self.assertEqual(resp.status, 200)
        cache.clear.assert_called_once()

    def test_clear_probe_cache_ok_when_disabled(self):
        # No cache → still a 200 (nothing to clear), so the button never errors.
        resp = stream_probe.clear_probe_status(_req(), RouteContext(engine=ENGINE))
        self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
