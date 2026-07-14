// Bootstrap: wires the DOM to the domains and runs init. Pure logic
// belongs in a lib module (tested under web/js_tests/), not here. Every
// import below is a domain's public interface (domains/<x>/index.js) or
// the shared/lib substrate — never a file behind a domain boundary.
import { $, showError, showBusy, hideBusy } from './shared/dom.js';
import { api } from './shared/api.js';
import { mountAcemanSelect } from './shared/dropdown.js';
import { setIcon } from './shared/icons.js';
import { noLocalDesktop, setNoLocalDesktop } from './shared/runtime.js';
import { KEYS } from './lib/storage_keys.js';
import { initWordmark } from './domains/wordmark/index.js';
import { initDiagnostics } from './domains/diagnostics/index.js';
import { initLifecycle } from './domains/lifecycle/index.js';
import { openResetModal, closeResetModal, runFactoryReset } from './domains/factory-reset/index.js';
import { initGpuCard, buildGpuParams, gpuEncodeLabel } from './domains/gpu/index.js';
import { refreshImageStatus, installImage, uninstallImage } from './domains/image/index.js';
import { initContainerMemory } from './domains/container-memory/index.js';
import { initSysUsage } from './domains/sys-usage/index.js';
import { initLogs } from './domains/logs/index.js';
import { refreshDesktopEntry, toggleDesktopEntry } from './domains/desktop/index.js';
import { onSearchInput, runSearch, searchPagePrev, searchPageNext } from './domains/search/index.js';
import { allFavs, loadFavs,
         updateSaveButton, saveFav, setFavSearch, favPagePrev, favPageNext } from './domains/favourites/index.js';
import { initLibrary, openLibrarySettings, closeLibrarySettings } from './domains/library/index.js';
import { initProbing } from './domains/probing/index.js';
import { setHistorySearch, histPagePrev, histPageNext, clearAllHistory } from './domains/history/index.js';
import { parseId, loadPlayers, loadBrowsers, detectCurrentBrowser, detectedPlayers,
         detectedBrowsers, _currentBrowserName, loadLastPlay, extractPlayCidFromUrl,
         resolveDisplayName, current, livePlaybackTarget, cfg, play, initPlaybackControls,
         renderPlaybackTargets, restartStream, refreshEngineStatus, engineState,
         clearNowPlaying, clearCidInput, refreshClearButton, setTabTitle, setNowPlayingName,
         waitForEngineReady, waitForBackend, refreshPlayerRowAlignment,
         movePlaybackToSelection, toggleEngine, toggleLanExpose, onPlaybackTargetChange, refreshDeviceStream, connectAndroidTv, onTvIpInput, onTvIpListClick, toggleTvIpDropdown, onPlaybackTitleClick, onPlaybackTitleDblClick, toggleDeviceLink, saveAutostart,
         setCfg, setCurrent } from './domains/playback/index.js';

// ---- init --------------------------------------------------------------
(async () => {
  initWordmark();

  // Identify the current browser before loadBrowsers' first dropdown
  // render, so it can label/filter same-name entries from the start.
  await detectCurrentBrowser();
  // Hold behind the "please wait" modal until the backend answers, so a
  // cold start doesn't drop the user onto a live page behind a
  // NetworkError. On timeout the calls below fall to the catch.
  await waitForBackend();
  try {
    const cfg = await api('/api/storage-mode');
    // Engine URL as a hover tooltip on the Engine corner-label.
    if (cfg.engine) $('engine-label').title = cfg.engine;
    // Search sources, one per line, surfaced as a tooltip on the
    // #search-status pill next to the Watch title.
    const searchStatus = $('search-status');
    if (searchStatus) {
      const srcs = Array.isArray(cfg.search_sources) ? cfg.search_sources : [];
      if (srcs.length) {
        searchStatus.title = srcs.length === 1
            ? `Source: ${srcs[0]}`
            : `Sources:\n  ${srcs.join('\n  ')}`;
      } else {
        searchStatus.title = '';
      }
    }
    // Hide Linux-desktop-only affordances when the browser is on another host.
    setNoLocalDesktop(!!cfg.no_local_desktop);
    if (noLocalDesktop) {
      // App launcher row: no Linux desktop to write a .desktop file to.
      const desktopRow = $('desktop-row');
      if (desktopRow) desktopRow.style.display = 'none';
      // Host-side players/browsers are unreachable from a browser on
      // another host, so renderPlaybackTargets trims the "Play in" list to
      // just "This tab" + "Another device" — keep the selector visible for
      // that choice, but drop the dedup toggle + no-target hint, which
      // don't apply.
      const showAllRow = $('show-all-row');
      if (showAllRow) showAllRow.style.display = 'none';
      const playerHint = $('player-hint');
      if (playerHint) playerHint.style.display = 'none';
    }
  } catch (e) {
    showError('Could not contact backend: ' + e.message);
  }

  try {
    setCfg(await api('/api/config'));
    $('autostart').checked = !!cfg.engine_autostart;
  } catch (_) { /* config endpoint may be disabled */ }

  // Favourites first; engine status second so the page doesn't flash
  // "engine offline" while loadFavs awaits the DB read.
  await loadFavs();
  await loadPlayers();
  await loadBrowsers();
  initGpuCard();  // fire-and-forget; card appears when broker responds
  // Replace the native <select> popup with the CSS-styled dropdown
  // (Firefox/Linux otherwise forces a system-purple option highlight).
  mountAcemanSelect($('playback-target'));
  // Just back from a Restart: mark the engine settling so the first
  // poll's likely "not running" reading doesn't promote a "Start
  // engine" button mid-bounce. Honor only breadcrumbs younger than 60s.
  const _restartedAt = parseInt(sessionStorage.getItem(KEYS.RESTARTED_AT) || '0', 10);
  sessionStorage.removeItem(KEYS.RESTARTED_AT);
  if (_restartedAt && Date.now() - _restartedAt < 60000) {
    engineState.markSettling();
    waitForEngineReady('Please wait while Aceman is getting ready…');
  }
  refreshEngineStatus();
  setInterval(refreshEngineStatus, 4000);

  initContainerMemory();
  initSysUsage();

  // The Play button toggles ▶ (idle) / ⏹ (playing anywhere — this tab,
  // another browser, vlc, mpv). Stop tears down the in-browser proxy
  // and any host-side wrapper holding mpv/vlc.
  $('restream-btn').onclick = () => restartStream();

  $('play-btn').onclick = async () => {
    if (livePlaybackTarget) {
      showBusy('Stopping…');
      try {
        try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
        catch (_) { /* best-effort */ }
        // Stop clears every visible referent in one step:
        //   clearNowPlaying()  resets the Watch card, hides the video,
        //                      clears the tab title, kills the in-browser
        //                      proxy, and clears `current`.
        //   clearCidInput()    wipes the cid so a new search can be typed.
        //   updateSaveButton() hides the now-stale Save-as-fav button.
        clearNowPlaying();
        clearCidInput();
        updateSaveButton();
      } finally { hideBusy(); }
    } else {
      showBusy('Starting…');
      try { await play(); } finally { hideBusy(); }
    }
  };
  // The Watch input is a read-only DISPLAY of the playing Ace ID. It
  // becomes editable only on double-click (the rare "paste a specific
  // id" case). Enter plays; Escape / blur returns it to display mode.
  const cid = $('cid-input');
  const exitCidEdit = (restore) => {
    cid.setAttribute('readonly', '');
    if (restore) cid.value = (current && current.cid) ? current.cid : '';
    refreshClearButton();
  };
  cid.addEventListener('dblclick', () => {
    cid.removeAttribute('readonly');
    cid.focus();
    cid.select();
  });
  cid.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (parseId(cid.value) === null) { showError('Enter a 40-hex Ace ID or an acestream:// URI.'); return; }
      exitCidEdit(false);
      play();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitCidEdit(true);
      cid.blur();
    }
  });
  cid.addEventListener('blur', () => exitCidEdit(true));
  cid.addEventListener('input', () => { refreshClearButton(); refreshDeviceStream(); });
  // Paste an Ace ID (or acestream:// URI) → play it straight away,
  // stopping whatever is playing first (play() tears the old stream down).
  // Listens at the document so Ctrl+V works whether or not the Watch field
  // is focused. Pastes into the search / favourites boxes are left alone;
  // pasting into the Watch field itself (display OR mid-edit) plays.
  document.addEventListener('paste', e => {
    const t = e.target;
    if (t && t !== cid && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (parseId(text) === null) return;
    e.preventDefault();
    // Return to display mode WITHOUT restoring the old cid, then drop in
    // the pasted value so a later blur can't revert it to what was playing.
    exitCidEdit(false);
    cid.value = text.trim();
    refreshClearButton();
    play();
  });
  $('cid-clear').onclick = () => clearCidInput();
  setIcon($('cid-clear'), 'close');   // fat X glyph
  // Click the playing title → copy the Ace ID to the clipboard (the input
  // already shows it). No-op while idle.
  $('playback-title').onclick = onPlaybackTitleClick;
  $('playback-title').ondblclick = onPlaybackTitleDblClick;
  $('save-btn').onclick = saveFav;
  $('engine-toggle').onclick = toggleEngine;
  $('autostart').onchange = saveAutostart;
  $('lan-expose').onchange = toggleLanExpose;
  $('device-stream-qr').onclick = toggleDeviceLink;
  $('playback-target').onchange = onPlaybackTargetChange;
  // Android TV (VLC) panel: Connect button + Enter in the IP field both
  // (re)connect and drive the one-time on-TV debugging approval.
  const tvConnect = $('androidtv-connect');
  if (tvConnect) tvConnect.onclick = () => connectAndroidTv();
  const tvIp = $('androidtv-ip');
  if (tvIp) {
    // Live search over the remembered IPs as you type; Enter connects.
    tvIp.addEventListener('input', onTvIpInput);
    tvIp.addEventListener('focus', onTvIpInput);
    tvIp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); connectAndroidTv(); }
      else if (e.key === 'Escape') {
        const l = $('androidtv-ip-list');
        if (l && !l.hidden) toggleTvIpDropdown();   // close only when open
      }
    });
  }
  const tvToggle = $('androidtv-ip-toggle');
  if (tvToggle) tvToggle.onclick = toggleTvIpDropdown;
  const tvList = $('androidtv-ip-list');
  if (tvList) tvList.onclick = onTvIpListClick;
  $('playback-move').onclick = () => movePlaybackToSelection();
  // "Show all browser installs" — UI-only preference in localStorage.
  const showAllCb = $('show-all-browsers');
  if (showAllCb) {
    showAllCb.checked = localStorage.getItem(KEYS.SHOW_ALL_BROWSERS) === '1';
    showAllCb.onchange = () => {
      localStorage.setItem(KEYS.SHOW_ALL_BROWSERS, showAllCb.checked ? '1' : '0');
      renderPlaybackTargets();
    };
  }
  initPlaybackControls();   // stats line toggle + in-tab buffer slider

  $('fav-search').oninput = e => setFavSearch(e.target.value);
  $('fav-prev').onclick = favPagePrev;
  $('fav-next').onclick = favPageNext;
  // Search tab: its own input (independent of the Watch/play field).
  $('search-input').addEventListener('input', onSearchInput);
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });
  $('search-prev').onclick = searchPagePrev;
  $('search-next').onclick = searchPageNext;
  // History tab: its own search box + pager + clear-all (mirrors favourites).
  $('history-search').oninput = e => setHistorySearch(e.target.value);
  $('history-prev').onclick = histPagePrev;
  $('history-next').onclick = histPageNext;
  $('history-clear').onclick = clearAllHistory;
  // ✕ clear buttons on each tab's search box (shown only when non-empty).
  const wireFieldClear = (inputId, clearId, apply) => {
    const inp = $(inputId), btn = $(clearId);
    if (!inp || !btn) return;
    setIcon(btn, 'close');   // fat X glyph
    const sync = () => { btn.style.visibility = inp.value ? 'visible' : 'hidden'; };
    inp.addEventListener('input', sync);
    btn.onclick = () => { inp.value = ''; sync(); apply(''); inp.focus(); };
    sync();
  };
  wireFieldClear('search-input', 'search-input-clear', () => runSearch());
  wireFieldClear('fav-search', 'fav-search-clear', v => setFavSearch(v));
  wireFieldClear('history-search', 'history-search-clear', v => setHistorySearch(v));
  // Library card: restore the last-open tab (Search / History / Favourites)
  // and wire the icon toggles.
  initLibrary();
  // ⚕ Probe-page health checks (wires its own button + row-marker observer).
  initProbing();
  // ⚙ Library settings modal (immediate-apply; close via ✕ / Escape / backdrop).
  $('library-cog').onclick = openLibrarySettings;
  $('library-settings-close').onclick = closeLibrarySettings;
  $('library-settings-modal').onclick = e => {
    if (e.target === $('library-settings-modal')) closeLibrarySettings();
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('library-settings-modal').style.display === 'flex') closeLibrarySettings();
  });
  $('desktop-toggle').onclick = toggleDesktopEntry;
  refreshDesktopEntry();

  $('image-install').onclick = installImage;
  $('image-uninstall').onclick = uninstallImage;
  refreshImageStatus();

  initLifecycle();   // Quit (shutdown) + Restart modal
  initLogs();

  $('factory-reset').onclick = openResetModal;
  $('reset-cancel').onclick = closeResetModal;
  $('reset-confirm-input').oninput = e => {
    $('reset-go').disabled = e.target.value !== 'RESET';
  };
  $('reset-go').onclick = runFactoryReset;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('reset-modal').style.display === 'flex') closeResetModal();
  });

  // ?play=<40-hex-cid> means an acestream:// URL was dispatched here via
  // xdg-mime. Strip the query (so reload doesn't re-play) and start.
  const _playCid = extractPlayCidFromUrl(window.location.search);
  if (_playCid) {
    history.replaceState(null, '', window.location.pathname);
    $('cid-input').value = _playCid;
    // Engine may not be up yet — block behind the busy modal until
    // container + API are healthy, then play. skipConfirm: opening this
    // URL already expressed intent, so skip the browser-target confirm.
    (async () => {
      const ready = await waitForEngineReady(
          'Please wait while Aceman is getting ready…');
      if (ready) play({ skipConfirm: true });
    })();
  } else {
    // No ?play=: rehydrate the input from the last-played stash so a
    // refresh during in-tab/browser playback doesn't blank the cid
    // (the in-browser case has no wrapper to rehydrate from).
    const last = loadLastPlay(localStorage);
    if (last && last.cid && /^[a-f0-9]{40}$/.test(last.cid)) {
      $('cid-input').value = last.cid;
      // Programmatic value set doesn't trigger the ✕ gate; poke it.
      refreshClearButton();
      // Render the channel name. resolveDisplayName prefers the current
      // allFavs entry (renames win) over the stash snapshot. allFavs may
      // still be loading, so render now and again once favs settle.
      const renderName = () => {
        const { name, sub } =
            resolveDisplayName(last, allFavs, last.cid);
        if (!name) return;
        setCurrent({ cid: last.cid, name, altName: sub });
        setTabTitle(name);
        setNowPlayingName(name, sub);
        $('now-playing').style.display = 'block';
        updateSaveButton();
      };
      renderName();
      setTimeout(renderName, 800);  // retry once favs have loaded
    }
  }

  // Keep the player-card row alignment in sync when it resizes.
  if (window.ResizeObserver) {
    const playerCard = $('player-card');
    if (playerCard) new ResizeObserver(() => refreshPlayerRowAlignment()).observe(playerCard);
  }
})();

// Registered synchronously at load (outside the async init) so the
// d→b→g shortcut works even if the backend handshake is still pending.
initDiagnostics();
