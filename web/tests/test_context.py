import unittest
from server.context import RouteContext

class TestContext(unittest.TestCase):
    def test_route_context_defaults(self):
        ctx = RouteContext()
        self.assertEqual(ctx.engine, "")
        self.assertIsNone(ctx.store)
        self.assertIsNone(ctx.engine_mgr)
        self.assertFalse(ctx.no_local_desktop)
        self.assertEqual(ctx.pending_play_cid_peek(), "")
        self.assertFalse(ctx.cpu_reencode())
