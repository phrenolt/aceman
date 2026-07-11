// Generic top-notice component — a non-blocking, dismissible banner for
// "heads-up (+ optional action)" messages, rendered into #notice-host.
// De-dupes by id (re-showing the same id updates in place). Reusable for
// any future notification. The pure class/action helpers live in
// lib/notice.js (unit-tested); this module owns the DOM construction.
//
// Business-agnostic by design: domain-specific notices (e.g. the
// playback "restart to apply" reminder) are built on top of showNotice
// from inside their own domain — this stays in shared/.

import { $ } from './dom.js';
import { noticeClassName, noticeHasAction } from '../lib/notice.js';

//   showNotice({ id, message, actionLabel, onAction, variant, autoDismissMs })
// autoDismissMs > 0 turns it into a transient toast: it fades out and removes
// itself after the delay, and skips the manual ✕ (it's ephemeral).
export function showNotice({ id, message, actionLabel, onAction, variant, autoDismissMs } = {}) {
  const host = $('notice-host');
  if (!host) return;
  let el = id ? host.querySelector('#' + (window.CSS ? CSS.escape(id) : id)) : null;
  if (!el) {
    el = document.createElement('div');
    if (id) el.id = id;
    host.appendChild(el);
  }
  // Re-showing the same id resets any pending auto-dismiss timer.
  if (el._dismissTimer) { clearTimeout(el._dismissTimer); el._dismissTimer = null; }
  el.className = noticeClassName(variant);
  el.style.opacity = '';
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
  if (!(autoDismissMs > 0)) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'notice-x';
    x.title = 'Dismiss';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '✕';
    x.onclick = () => el.remove();
    actions.appendChild(x);
  }
  el.appendChild(actions);

  if (autoDismissMs > 0) {
    el._dismissTimer = setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      el._dismissTimer = setTimeout(() => el.remove(), 400);
    }, autoDismissMs);
  }
}

export function dismissNotice(id) {
  const host = $('notice-host');
  const el = host && id
    ? host.querySelector('#' + (window.CSS ? CSS.escape(id) : id))
    : null;
  if (el) el.remove();
}
