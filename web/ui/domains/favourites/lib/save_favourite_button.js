// Pure mapping for the "Save as favourite" / star indicator button
// next to the cid input.
//
// Three states:
//   1) no stream playing            → hidden
//   2) playing, NOT yet in favourites → "Save as favourite", enabled
//   3) playing, ALREADY in favourites → "★ Saved as <name>", disabled
//
// The lookup is delegated to ./fav_lookup.js so the same
// case-insensitive cid-match policy is shared with every other
// favourites query in the app.
//
// Pure. No DOM, no globals.

import { findFavouriteByCid } from './favourite_lookup.js';

// `existingFav` lets a caller that already resolved the favourite pass it in
// to avoid a second list scan; omitted, we look it up ourselves.
export function describeSaveButton(current, favs, existingFav) {
  if (!current) return HIDDEN;
  const fav = existingFav !== undefined ? existingFav : findFavouriteByCid(favs, current.cid);
  if (fav) {
    return {
      visible: true,
      text: `★ Saved as "${fav.name}"`,
      disabled: true,
      title: 'Already in your favourites — open the Favourites column to manage.',
    };
  }
  return {
    visible: true,
    text: 'Save as favourite',
    disabled: false,
    title: '',
  };
}

const HIDDEN = Object.freeze({
  visible: false,
  text: '',
  disabled: false,
  title: '',
});
