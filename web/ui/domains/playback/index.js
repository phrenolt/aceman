// Public interface for the playback domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { _currentBrowserName, detectCurrentBrowser, detectedBrowsers, detectedPlayers, loadBrowsers, loadPlayers } from './detection.js';
export { parseId } from './lib/content_id_parser.js';
export { loadLastPlay } from './lib/last_played_stream.js';
export { extractPlayCidFromUrl } from './lib/play_query_param.js';
export { bufferLabel } from './lib/playback_buffer.js';
export { resolveDisplayName } from './lib/playback_display_name.js';
export { initPlaybackControls } from './playback_controls.js';
export { cfg, clearCidInput, clearNowPlaying, current, engineState, isCurrentlyPlaying, livePlaybackTarget, movePlaybackToSelection, notifyIfAlreadyPlaying, notifyRestartNeeded, persistPlaybackTarget, play, refreshClearButton, refreshEngineStatus, refreshPlayerRowAlignment, renderPlaybackTargets, restartStream, saveAutostart, setCfg, setCurrent, setNowPlayingName, setTabTitle, toggleEngine, toggleLanExpose, onPlaybackTargetChange, refreshDeviceStream, connectAndroidTv, stopAndroidTv, onTvIpInput, onTvIpListClick, toggleTvIpDropdown, copyPlayingCid, onPlaybackTitleClick, onPlaybackTitleDblClick, toggleDeviceLink, waitForBackend, waitForEngineReady } from './playback.js';
