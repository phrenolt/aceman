# shared/container/lib.sh — shared shell helpers for the aceman wrappers.
#
# Sourced by aceman, aceman_web, engine/container/run-container.sh, and
# web/container/run-web-container.sh. One file keeps the
# WSL-detection regex, port/size validators, image-build flow, and
# shared-network plumbing in one place so the four wrappers can't drift
# apart on details that have to agree (e.g. "what counts as WSL", "is
# the engine image present", "what's the shared network called").
#
# Conventions:
#   * Every helper returns 0 on success and non-zero with a message on
#     stderr on failure. Callers under `set -e` propagate that.
#   * The shared $PROG variable (default "aceman") is prefixed onto
#     diagnostic messages so the user can tell which wrapper spoke.
#   * No state is mutated except where documented; sourcing this file
#     is side-effect free.

# ---- platform detection -------------------------------------------------

# True iff we're running under WSL. The kernel exposes a single string
# in /proc/sys/kernel/osrelease that includes "microsoft" or "WSL" on
# every supported WSL version. Cheaper than spawning `uname -r`.
is_wsl() {
    grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease 2>/dev/null
}

# Echo the first IPv4 address from `hostname -I` (the WSL guest IP in
# NAT mode). Returns 1 if hostname produced nothing — caller decides
# whether that's fatal.
wsl_guest_ip() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1; exit}')"
    [ -n "$ip" ] || return 1
    printf '%s' "$ip"
}

# ---- input validation ---------------------------------------------------

# Validate a TCP/UDP port number: integer in [1, 65535]. $2 is the
# label used in the error message. Echoes nothing; returns non-zero on
# bad input with a stderr message.
validate_port() {
    local val="$1" label="${2:-port}" prog="${PROG:-aceman}"
    [[ "$val" =~ ^[0-9]+$ ]] \
        || { echo "$prog: $label must be a number: $val" >&2; return 1; }
    [ "$val" -ge 1 ] && [ "$val" -le 65535 ] \
        || { echo "$prog: $label out of range (1-65535): $val" >&2; return 1; }
}

# Validate a podman-style size spec: digits with optional g/m/k suffix
# (case-insensitive). $2 is the label used in the error message.
validate_size_spec() {
    local val="$1" label="${2:-size}" prog="${PROG:-aceman}"
    [[ "$val" =~ ^[0-9]+[gGmMkK]?$ ]] \
        || { echo "$prog: $label must look like 3g / 512m / 1024k / bare bytes (got: $val)" >&2; return 1; }
}

# ---- image builds -------------------------------------------------------

# ---- commit-based image identity ---------------------------------------
#
# We label every built image with `aceman.commit=<sha>` and check that
# label on each launch. Match → skip rebuild; mismatch → rebuild. This
# is deterministic where mtime is fragile: `git pull` updates mtimes
# only for changed files, `git checkout` rewrites them all, `__pycache__`
# entries pollute the newest-file probe, and `date -d` chokes on the
# `+0000 UTC` suffix podman emits for `{{.Created}}`. Commit shas
# don't have any of those problems.
#
# Dirty trees (uncommitted changes at HEAD) DON'T trust the label —
# we rebuild every launch in that case. The layer cache keeps that
# rebuild cheap (<1 s when nothing changed; just the final COPY layer
# when something did).

# Echo a full SHA for the spec ("HEAD" by default), or empty if we're
# not in a git repo. Resolves to refs, short shas, tags — anything
# `git rev-parse` accepts.
_resolve_commit() {
    local spec="${1:-HEAD}"
    local root="${ACELIB_PROJECT_ROOT:?}"
    ( cd "$root" && git rev-parse --verify "$spec" 2>/dev/null ) || return 1
}

# True iff the working tree has uncommitted changes (tracked files
# only — untracked files don't count as "dirty" for build purposes,
# they aren't in the Containerfile's COPY).
_repo_is_dirty() {
    local root="${ACELIB_PROJECT_ROOT:?}"
    ! ( cd "$root" \
        && git diff --quiet --ignore-submodules HEAD 2>/dev/null \
        && git diff --quiet --cached --ignore-submodules 2>/dev/null )
}

# Echo the commit label stored on an image. Empty if no label / no
# image / podman missing.
_image_commit_label() {
    podman image inspect "$1" --format '{{index .Labels "aceman.commit"}}' \
        2>/dev/null
}

# Internal helper — given a tag + context + Containerfile, decide
# whether a rebuild is needed and run it. Adds the aceman.commit
# label on success.
#
# Args:
#   $1 = image tag
#   $2 = build context dir (passed as `.` after cd)
#   $3 = absolute Containerfile path
#   $4 = label for messages ("engine", "web")
#   $5 = optional prerequisite file (absent → guided error)
#   $6 = optional extra guidance line printed when $5 is missing
_ensure_podman_image() {
    local tag="$1" ctx="$2" cf="$3" label="$4"
    local pre="${5:-}" pre_hint="${6:-}"
    local prog="${PROG:-aceman}"
    command -v podman >/dev/null || return 0

    # Resolve the desired commit (HEAD by default; user-pinned via
    # ACE_COMMIT). Outside a git repo we just track presence.
    local want_sha
    want_sha="$(_resolve_commit "${ACE_COMMIT:-HEAD}")" || want_sha=""
    local dirty=0
    [ "${ACE_COMMIT:-HEAD}" = "HEAD" ] && _repo_is_dirty && dirty=1

    # Cache hit: image exists AND its label matches AND we're not
    # carrying uncommitted changes that would make the label a lie.
    if [ "$dirty" = 0 ] && [ -n "$want_sha" ] \
       && podman image exists "$tag" 2>/dev/null; then
        local have_sha
        have_sha="$(_image_commit_label "$tag")"
        if [ "$have_sha" = "$want_sha" ]; then
            return 0
        fi
    fi

    [ -d "$ctx" ] || {
        echo "$prog: $label build context missing: $ctx" >&2; return 1; }
    [ -f "$cf" ] || {
        echo "$prog: $label Containerfile missing: $cf" >&2; return 1; }
    if [ -n "$pre" ] && [ ! -f "$pre" ]; then
        echo "$prog: $label prerequisite missing: $pre" >&2
        [ -n "$pre_hint" ] && echo "  $pre_hint" >&2
        return 1
    fi

    # Human-readable build banner so the user knows WHY a rebuild
    # fires. "fresh" → no image yet; "pinned" → ACE_COMMIT set;
    # "dirty" → uncommitted changes; otherwise a label drift.
    local why="commit ${want_sha:0:12}"
    if ! podman image exists "$tag" 2>/dev/null; then
        why="$why (first build, ~2 min)"
    elif [ "$dirty" = 1 ]; then
        why="$why-dirty (uncommitted changes; rebuild every launch)"
    elif [ "${ACE_COMMIT:-HEAD}" != "HEAD" ]; then
        why="$why (pinned by --commit)"
    else
        why="$why (newer than current image)"
    fi
    echo "$prog: building $label image '$tag' — $why" >&2

    local label_args=()
    [ "$dirty" = 0 ] && [ -n "$want_sha" ] \
        && label_args=(--label "aceman.commit=$want_sha")
    # Bake the build identity into the WEB image so the in-page `dbg`
    # overlay can show the commit regardless of launch path (the broker
    # recreate doesn't carry a runtime env). Web-only so the engine build
    # doesn't warn about ARGs it doesn't declare.
    local build_args=()
    [ "$label" = "web" ] \
        && build_args=(--build-arg "ACEMAN_COMMIT=$want_sha"
                       --build-arg "ACEMAN_DIRTY=$dirty")
    ( cd "$ctx" && podman build -t "$tag" -f "$cf" \
        "${label_args[@]}" "${build_args[@]}" . ) >&2 || {
        echo "$prog: $label image build failed; see output above" >&2
        return 1
    }
}

# Extract the source tree of a given commit into a temp directory so
# `podman build` can use it as the context. Needed when ACE_COMMIT
# points at something other than HEAD. The engine tarball isn't in
# git (`.gitignore`), so we splice the current dist/engine.tar.gz
# into the temp context after extraction — the wrapper running this
# is from the current working tree, so its tarball is what the user
# has on disk right now. Echoes the temp dir path; caller is
# responsible for `rm -rf` after the build.
_extract_commit_tree() {
    local sha="$1"
    local root="${ACELIB_PROJECT_ROOT:?}"
    local prog="${PROG:-aceman}"
    local tmp
    tmp="$(mktemp -d -t aceman-build-XXXXXX)" || return 1
    if ! ( cd "$root" && git archive --format=tar "$sha" | tar -x -C "$tmp" ); then
        echo "$prog: git archive $sha failed" >&2
        rm -rf "$tmp"
        return 1
    fi
    # Engine tarball is .gitignored. Copy from the running checkout so
    # the engine image build at this commit has something to extract.
    if [ -f "$root/engine/container/dist/engine.tar.gz" ]; then
        mkdir -p "$tmp/engine/container/dist"
        cp "$root/engine/container/dist/engine.tar.gz" \
           "$tmp/engine/container/dist/engine.tar.gz"
    fi
    printf '%s' "$tmp"
}

# Ensure the engine container image is present and labelled with the
# desired commit. Build context is engine/container/.
ensure_engine_image() {
    local root="${ACELIB_PROJECT_ROOT:?ACELIB_PROJECT_ROOT must be set}"
    local tag="${ACE_IMAGE:-localhost/acestream:vetted}"
    local ctx="$root/engine/container"
    local cf="$ctx/Containerfile"
    local pre="$ctx/dist/engine.tar.gz"
    local hint="download from acestream.media and place it at the path above, then re-run."

    if [ -n "${ACE_COMMIT:-}" ] && [ "$ACE_COMMIT" != "HEAD" ]; then
        local sha tmp
        sha="$(_resolve_commit "$ACE_COMMIT")" || {
            echo "${PROG:-aceman}: invalid commit: $ACE_COMMIT" >&2; return 1; }
        tmp="$(_extract_commit_tree "$sha")" || return 1
        local rc=0
        ACE_COMMIT="$sha" _ensure_podman_image \
            "$tag" "$tmp/engine/container" "$tmp/engine/container/Containerfile" \
            "engine" "$tmp/engine/container/dist/engine.tar.gz" "$hint" \
            || rc=$?
        rm -rf "$tmp"
        return "$rc"
    fi
    _ensure_podman_image "$tag" "$ctx" "$cf" "engine" "$pre" "$hint"
}

# Ensure the web container image is present and labelled. Build
# context is the project root because Containerfile.web does
# `COPY web /app/web`.
ensure_web_image() {
    local root="${ACELIB_PROJECT_ROOT:?ACELIB_PROJECT_ROOT must be set}"
    local tag="${ACE_WEB_IMAGE:-localhost/aceman-web:vetted}"
    local cf="$root/web/container/Containerfile.web"

    if [ -n "${ACE_COMMIT:-}" ] && [ "$ACE_COMMIT" != "HEAD" ]; then
        local sha tmp
        sha="$(_resolve_commit "$ACE_COMMIT")" || {
            echo "${PROG:-aceman}: invalid commit: $ACE_COMMIT" >&2; return 1; }
        tmp="$(_extract_commit_tree "$sha")" || return 1
        local rc=0
        ACE_COMMIT="$sha" _ensure_podman_image \
            "$tag" "$tmp" "$tmp/web/container/Containerfile.web" "web" \
            || rc=$?
        rm -rf "$tmp"
        return "$rc"
    fi
    _ensure_podman_image "$tag" "$root" "$cf" "web"
}

# ---- shared podman network ---------------------------------------------

# Create the shared user-defined bridge if it doesn't exist. Engine +
# web both join this network so the web reaches the engine at
# http://$ACE_NAME:6878 instead of via the host bridge gateway.
ensure_shared_network() {
    local net="${ACE_NETWORK:-aceman-net}"
    command -v podman >/dev/null || return 0
    if podman network exists "$net" 2>/dev/null; then
        return 0
    fi
    podman network create "$net" >/dev/null \
        || { echo "${PROG:-aceman}: failed to create podman network '$net'" >&2; return 1; }
}

# Attach an already-running container to the shared network if it
# isn't a member yet. Idempotent. Used during an in-place upgrade so a
# pre-existing engine on the old default bridge doesn't strand the web
# UI ("can't resolve http://ace").
attach_to_shared_network() {
    local container="$1" net="${ACE_NETWORK:-aceman-net}"
    [ -n "$container" ] || return 0
    command -v podman >/dev/null || return 0
    podman container exists "$container" 2>/dev/null || return 0
    if podman inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
            "$container" 2>/dev/null | grep -qw -- "$net"; then
        return 0
    fi
    podman network connect "$net" "$container" 2>/dev/null || true
}
