// Public interface for the sys-usage domain. Other slices (and the
// bootstrap) import from here, never from the files behind it — this is
// the boundary. Internals stay private to the folder.

export { initSysUsage } from './sys_usage.js';
