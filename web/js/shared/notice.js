// Generic top-notice component — a non-blocking, dismissible banner for
// "heads-up (+ optional action)" messages, rendered into #notice-host.
// De-dupes by id (re-showing the same id updates in place). Reusable for
// any future notification. The pure class/action helpers live in
// lib/notice.js (unit-tested); this module owns the DOM construction.
//
// notifyRestartNeeded reaches back into the playback core (the live
// target + restartStream) — a transitional import from app.js until
// playback is its own module.

import { $ } from './dom.js';
import { noticeClassName, noticeHasAction } from '../lib/notice.js';
import { livePlaybackTarget, restartStream } from '../domains/playback/playback.js';

//   showNotice({ id, message, actionLabel, onAction, variant })
export function showNotice({ id, message, actionLabel, onAction, variant } = {}) {
  const host = $('notice-host');
  if (!host) return;
  let el = id ? host.querySelector('#' + (window.CSS ? CSS.escape(id) : id)) : null;
  if (!el) {
    el = document.createElement('div');
    if (id) el.id = id;
    host.appendChild(el);
  }
  el.className = noticeClassName(variant);
  el.setAttribute('role', 'status');
  el.replaceChildren();
  const msg = document.createElement('span');
  msg.className = 'notice-msg';
  msg.textContent = message || '';
  el.appendChild(msg);
  const actions = document.createElement('span');
  actions.className = 'notice-actions';
  if (noticeHasAction(actionLabel, onAction)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-btn';
    btn.textContent = actionLabel;
    btn.onclick = onAction;
    actions.appendChild(btn);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'notice-x';
  x.title = 'Dismiss';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '✕';
  x.onclick = () => el.remove();
  actions.appendChild(x);
  el.appendChild(actions);
}

export function dismissNotice(id) {
  const host = $('notice-host');
  const el = host && id
    ? host.querySelector('#' + (window.CSS ? CSS.escape(id) : id))
    : null;
  if (el) el.remove();
}

// Reminder that a setting change (buffer / GPU) only applies on the next
// stream start. Shown only while something is live — nothing to restart
// otherwise. Thin wrapper over the generic notice above.
export function notifyRestartNeeded() {
  if (!livePlaybackTarget) return;
  showNotice({
    id: 'restart-needed',
    message: 'Setting changed — restart the stream for it to take effect.',
    actionLabel: '↺ Restart stream',
    onAction: () => { dismissNotice('restart-needed'); restartStream(); },
  });
}
