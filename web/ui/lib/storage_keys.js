// Centralised localStorage / sessionStorage key names.
//
// Why this file exists: every key string used to live inline at its
// read site, so a rename required hunting through 2 k lines and
// praying every reference matched. With KEYS as the single source
// of truth a new key is named once and referenced symbolically
// everywhere.

export const KEYS = Object.freeze({
  LAST_PLAY: 'aceman.lastPlay',
  GLOW: 'aceman.acemanGlow',
  SHOW_ALL_BROWSERS: 'aceman.showAllBrowsers',
  PLAYBACK_BUFFER: 'aceman.playbackBuffer',       // in-tab pre-roll seconds
  RESTARTED_AT: 'aceman.restartedAt',             // sessionStorage breadcrumb
  GPU_ACCEL: 'aceman.gpuAccel',                   // GPU acceleration settings JSON
  STATS_HIDDEN: 'aceman.statsHidden',             // user dismissed the stats line
  LIBRARY_TAB: 'aceman.libraryTab',               // last-open library card tab
  PAGE_SIZE: 'aceman.pageSize',                   // rows per page (search/favs/history)
  REMOVE_FROM_HISTORY_ON_SAVE: 'aceman.removeFromHistoryOnSave',
  MSE_CAP_BYTES: 'aceman.mseCapBytes',            // learned SourceBuffer byte ceiling
  DEEP_PROBE: 'aceman.deepProbe',                 // probe checks playability (ffprobe) + logs failures
  PROBE_AGENTS: 'aceman.probeAgents',             // concurrent probe agents (pool size)
  PROBE_FRESHNESS_MINS: 'aceman.probeFreshnessMins', // skip re-probe if verdict this fresh (canonical minutes)
  PROBE_FRESHNESS_UNIT: 'aceman.probeFreshnessUnit', // display unit for the above: 'min' | 'hours'
  PROBE_SCOPE: 'aceman.probeScope',               // selected scope in the ⚕ panel
  PROBE_KEEP_UPDATED: 'aceman.probeKeepUpdated',  // auto re-probe the selected scope as it changes
  FAV_SORT: 'aceman.favSort',                     // favourites order: 'name' | 'recent'
  LIBRARY_DEFAULT_TAB: 'aceman.libraryDefaultTab', // tab to open the Library on: 'last'|search|favourites|history
  RELATIVE_TIMES: 'aceman.relativeTimes',         // show "3d ago" vs an absolute stamp
  SKIP_DELETE_CONFIRM: 'aceman.skipDeleteConfirm', // skip the "are you sure?" on deletes
  VOLUME: 'aceman.volume',                        // in-tab player volume 0..1
  MUTED: 'aceman.muted',                          // in-tab player muted flag ('1'/'0')
});
