"""Bundle-level execution smoke test — the flattened browser bundle must RUN,
not merely parse.

The ESM unit tests (``node --test`` on ``ui/**``) import each module through the
native module loader, which resolves the whole graph in dependency order before
any top-level code runs. So a module-scope statement that reads another module's
binding is always safe there — the dependency is initialised first.

The BROWSER doesn't get that. ``aceman_web._bundle_js()`` concatenates every
module into ONE classic-script IIFE in *file order* (ui/lib/** sorted, then
shared, then domains, then main.js) with the import/export keywords stripped. If
a file's top-level statement reads a name declared in a file that sorts *later*,
the concatenated IIFE hits that name in its temporal dead zone and the whole app
dies at startup with "Cannot access 'X' before initialization" — invisible to
every ESM test.

Regression this guards: ``library_settings.js`` built a module-level const from
``KEYS`` (declared in ``storage_keys.js``, which sorts AFTER it), crashing the
bundle on load. The fix defers the ``KEYS`` read into a function.

This runs the REAL bundle through Node under a DOM stub (same path as
ui/tools/check_bundle.sh + smoke_import.mjs), so any import-order TDZ, missing
name, or duplicate identifier that only manifests once flattened is caught here.
Skipped when podman or the Node image isn't available (mirrors the JS suite's
"no host toolchain" stance).
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import shutil
import subprocess
import unittest

import aceman_web

JS_IMAGE = "docker.io/library/node:lts-krypton"
_WEB = pathlib.Path(aceman_web.__file__).resolve().parent
_UI = _WEB / "ui"


def _podman() -> str | None:
    return shutil.which("podman")


def _image_present(podman: str) -> bool:
    return subprocess.run(
        [podman, "image", "exists", JS_IMAGE],
        capture_output=True,
    ).returncode == 0


@unittest.skipUnless(_podman(), "podman not available — skipping bundle run")
class BundleExecutesTests(unittest.TestCase):
    """The generated bundle must load without throwing in its init prefix."""

    def setUp(self):
        self.podman = _podman()
        if not _image_present(self.podman):
            self.skipTest(f"{JS_IMAGE} not pulled — skipping bundle run")
        # Write the real bundle inside ui/tools so it's on the mounted path and
        # smoke_import.mjs (a sibling) can import it by relative target.
        self.gen = _UI / "tools" / ".bundle_exec_test.mjs"
        self.gen.write_text(aceman_web._bundle_js(), encoding="utf-8")

    def tearDown(self):
        self.gen.unlink(missing_ok=True)

    def test_bundle_loads_without_tdz(self):
        rel = self.gen.relative_to(_UI)                      # tools/.bundle_exec_test.mjs
        proc = subprocess.run(
            [
                self.podman, "run", "--rm", "--read-only", "--tmpfs", "/tmp",
                "--network=none",
                "-v", f"{_UI}:/work/web/ui:ro,Z", "-w", "/work",
                JS_IMAGE,
                "node", "web/ui/tools/smoke_import.mjs", f"web/ui/{rel}",
            ],
            capture_output=True, text=True, timeout=120,
        )
        # smoke_import.mjs prints "LINK OK" / "LINK FAIL … → <message>" and exits
        # non-zero on any failure. Surface its output so a TDZ regression names
        # the offending binding directly.
        self.assertEqual(
            proc.returncode, 0,
            msg=f"bundle failed to load:\n{proc.stdout}\n{proc.stderr}",
        )
        self.assertIn("LINK OK", proc.stdout)


if __name__ == "__main__":
    unittest.main()
