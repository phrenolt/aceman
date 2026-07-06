// Public interface for the library domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { initLibrary, showTab, openFavourite, buildSavedBadge,
         openLibrarySettings, closeLibrarySettings, saveLibrarySettings } from './library.js';
