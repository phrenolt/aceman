// Pure view-model for a channel's probe marker: maps a health state (+ the
// backend's detail payload) to the glyph, CSS class, aria label, and tooltip
// the row badge renders. Kept pure + unit-tested so probing.js stays DOM-only.
//
// States:
//   checking …  transient, in-flight (frontend only)
//   healthy  ●  green  — plays now, fast first byte
//   slow     ●  amber  — plays, but slow to start
//   unplayable ▲ orange — bytes flow but the format isn't decodable (deep probe)
//   dead     ✕  red    — no data (offline / no peers right now)
//   unreachable – grey — couldn't open a session (engine refused/down)
//   playing  ▶  green  — the channel you're watching; skipped (not probed)
//   unknown  –  grey   — fallback for any unexpected state

const VIEW = {
  checking:   { cls: 'probe-checking',   glyph: '…', label: 'Checking…' },
  healthy:    { cls: 'probe-healthy',    glyph: '●', label: 'Healthy' },
  slow:       { cls: 'probe-slow',       glyph: '●', label: 'Slow to load' },
  unplayable: { cls: 'probe-unplayable', glyph: '▲', label: 'Unplayable format' },
  dead:       { cls: 'probe-dead',       glyph: '✕', label: 'Dead' },
  unreachable:{ cls: 'probe-unreachable',glyph: '–', label: 'Unreachable' },
  playing:    { cls: 'probe-playing',    glyph: '▶', label: 'Playing now' },
  unknown:    { cls: 'probe-unknown',    glyph: '–', label: 'Unknown' },
};

export const PROBE_STATES = Object.keys(VIEW);

// "0.06" style — trim trailing zeros so "6.00s" reads "6s" and "0.50s" "0.5s".
function fmtSecs(s) {
  if (typeof s !== 'number' || !isFinite(s)) return null;
  return s.toFixed(2).replace(/\.?0+$/, '') + 's';
}

export function probeTitle(state, detail = {}) {
  const fb = fmtSecs(detail && detail.first_byte_secs);
  const reason = detail && detail.reason;
  switch (state) {
    case 'checking':
      return 'Checking…';
    case 'healthy':
      return 'Healthy — plays now' + (fb ? ` (first data in ${fb})` : '')
           + (reason ? `\n${reason}` : '');
    case 'slow':
      return 'Slow to load' + (fb ? ` — first data took ${fb}` : '')
           + '. It works, but takes a while to start.';
    case 'unplayable':
      return 'Bytes flow, but the format is not playable'
           + (reason ? `:\n${reason}` : '.')
           + '\nLogged — export the list from Library settings.';
    case 'dead':
      return 'No data — the channel looks offline right now. A channel that '
           + 'normally works can read as dead if it is momentarily unseeded '
           + 'or off-air.';
    case 'unreachable':
      return 'Could not open a session — the engine refused or is unreachable.'
           + (reason ? `\n${reason}` : '');
    case 'playing':
      return 'This is the channel you are watching — skipped (probing it would '
           + 'interrupt your stream).';
    default:
      return 'Unknown.';
  }
}

// state, detail -> { state, cls, glyph, label, title }. An unrecognised
// state normalises to 'unknown' so a bad payload can't produce an empty badge.
export function probeView(state, detail) {
  const s = VIEW[state] ? state : 'unknown';
  const base = VIEW[s];
  return {
    state: s,
    cls: base.cls,
    glyph: base.glyph,
    label: base.label,
    title: probeTitle(s, detail),
  };
}
