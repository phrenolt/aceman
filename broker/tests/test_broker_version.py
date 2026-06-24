"""Tests for the broker.version action and its commit-pinning.

The launcher wrapper restarts a broker whose LAUNCH commit has fallen
behind the working tree. For that to work the action must report the
commit frozen at process start (``config.STARTUP_COMMIT``), not a
freshly-resolved HEAD — otherwise a stale broker would always look
current and never get restarted.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest
import unittest.mock as mock

from aceman_broker import config
from aceman_broker.actions import web_lifecycle


class BrokerVersionActionTests(unittest.TestCase):
    def test_reports_pinned_startup_commit(self):
        # Even if HEAD moves at call time, the action returns the value
        # frozen at import — that gap is what drives the restart. The
        # action reads the name imported into web_lifecycle, so that's
        # the binding to patch.
        with mock.patch.object(web_lifecycle, "STARTUP_COMMIT",
                               "deadbeef" * 5):
            rep = web_lifecycle.action_broker_version({})
        self.assertEqual(rep, {"commit": "deadbeef" * 5})

    def test_empty_commit_outside_git_repo(self):
        with mock.patch.object(web_lifecycle, "STARTUP_COMMIT", ""):
            rep = web_lifecycle.action_broker_version({})
        self.assertEqual(rep, {"commit": ""})

    def test_ignores_params(self):
        with mock.patch.object(web_lifecycle, "STARTUP_COMMIT", "abc123"):
            rep = web_lifecycle.action_broker_version({"anything": "here"})
        self.assertEqual(rep, {"commit": "abc123"})


class HeadShaTests(unittest.TestCase):
    def test_head_sha_empty_when_git_missing(self):
        with mock.patch("aceman_broker.config.subprocess.run",
                        side_effect=FileNotFoundError):
            self.assertEqual(config.head_sha(), "")

    def test_head_sha_empty_on_nonzero_return(self):
        fake = mock.Mock(returncode=128, stdout="", stderr="not a repo")
        with mock.patch("aceman_broker.config.subprocess.run",
                        return_value=fake):
            self.assertEqual(config.head_sha(), "")

    def test_head_sha_strips_trailing_newline(self):
        fake = mock.Mock(returncode=0, stdout="abc123\n", stderr="")
        with mock.patch("aceman_broker.config.subprocess.run",
                        return_value=fake):
            self.assertEqual(config.head_sha(), "abc123")


if __name__ == "__main__":
    unittest.main()
