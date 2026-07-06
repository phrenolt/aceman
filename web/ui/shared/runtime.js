// App-wide runtime flags, resolved once at bootstrap from
// /api/storage-mode and then read across the app. Business-agnostic:
// they describe the storage backend and the host environment, not any
// feature. Single-writer — only the bootstrap calls the setters; every
// other module imports the live `noLocalDesktop` binding read-only.

// No-local-desktop mode: this server has no Linux desktop the user can
// use, because the page is served to a browser on another host — a WSL
// or Lima guest, or a remote server. When true, Linux-desktop-only UI
// (the App-launcher card + acestream:// scheme handler) is hidden — none
// of it can act on a desktop the user isn't at.
export let noLocalDesktop = false;
export function setNoLocalDesktop(value) { noLocalDesktop = value; }
