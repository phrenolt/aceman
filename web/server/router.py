"""Tiny method+path router.

Replaces the ``if/elif`` chain in ``Handler.do_GET/do_POST``. A route
is registered with a method, a path pattern, and a handler function
that takes ``(request, ctx) -> Response``.

Patterns use Python's ``str.format``-ish notation with named segments::

    "/api/favs/{name}"

…which matches one path segment (no slash) and surfaces it as
``request.path_params["name"]``. We deliberately do NOT support
regex-style patterns or optional segments — every route in this app
is shallow enough that the simpler grammar covers it, and a richer
grammar would invite the security mistakes the router exists to
avoid (path-component traversal, ambiguous matches, prefix matches
across slash boundaries).
"""

from __future__ import annotations

import re
import urllib.parse
from typing import Callable

from .context import RouteContext
from .http_io import Request, Response


# A route function takes the request + context and returns a response.
RouteFn = Callable[[Request, RouteContext], Response]


class Router:
    """Map (method, path) to a RouteFn. Path patterns may contain
    ``{name}``-style segments that capture into ``path_params``."""

    _SEG_RE = re.compile(r"\{([A-Za-z_][A-Za-z_0-9]*)\}")

    def __init__(self) -> None:
        # Per-method list of (compiled_regex, param_names, fn).
        # Lookup is linear because we only ever register ~30 routes.
        self._routes: "dict[str, list[tuple[re.Pattern, list[str], RouteFn]]]" = {}

    def add(self, method: str, pattern: str, fn: RouteFn) -> None:
        params: "list[str]" = []

        def _sub(m):
            params.append(m.group(1))
            # One path segment — no slashes allowed inside a single
            # `{name}`. This is the security-critical line: without
            # the "no slash" anchor, a name like `..%2Fetc%2Fpasswd`
            # could match a route expecting just "{name}" and the
            # route handler would see the full path-traversal string.
            return r"(?P<%s>[^/]+)" % m.group(1)

        regex = re.compile("^" + self._SEG_RE.sub(_sub, pattern) + "$")
        self._routes.setdefault(method, []).append((regex, params, fn))

    def get(self, p, fn):    self.add("GET", p, fn)
    def post(self, p, fn):   self.add("POST", p, fn)
    def delete(self, p, fn): self.add("DELETE", p, fn)
    def patch(self, p, fn):  self.add("PATCH", p, fn)

    def resolve(self, method: str, path: str) -> "tuple[RouteFn, dict] | None":
        """Return ``(fn, path_params)`` for the first matching route, or
        ``None`` if nothing matches."""
        for regex, params, fn in self._routes.get(method, []):
            m = regex.match(path)
            if m:
                pp = {n: urllib.parse.unquote(m.group(n)) for n in params}
                # The `[^/]+` segment pattern runs against the still
                # percent-ENCODED path, so `..%2Fetc%2Fpasswd` matches it
                # and only becomes `../etc/passwd` in the unquote above.
                # Refuse decoded params shaped like a traversal so the
                # "handlers never see traversal strings" promise holds
                # even for a future route that splices a param into a
                # filesystem path. A bare interior slash stays allowed —
                # favourite names are free text ("Alpha/Beta" is legal and the
                # UI addresses it as Alpha%2FBeta), and an interior slash can
                # only descend, never climb or go absolute.
                if any(self._traversal_risk(v) for v in pp.values()):
                    return None
                return fn, pp
        return None

    @staticmethod
    def _traversal_risk(value: str) -> bool:
        """True when a decoded path param could climb out of, or
        absolutely repoint, a directory it might one day be joined to:
        a bare dot segment, a leading separator (pathlib's `/` operator
        REPLACES the base when the right side is absolute), or a `..`
        component anywhere between separators."""
        if value in (".", ".."):
            return True
        if value.startswith(("/", "\\")):
            return True
        return any(part == ".." for part in re.split(r"[/\\]", value))
