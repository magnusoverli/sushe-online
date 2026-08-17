/**
 * Registers app-wide window globals for legacy integration points.
 */

export function registerAppWindowGlobals(deps = {}) {
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  if (!win) return;

  const {
    selectList,
    updateListNav,
    collapseGroupsForActiveList,
    displayAlbums,
    openAlbum,
  } = deps;

  win.selectList = selectList;
  win.updateListNav = updateListNav;
  win.collapseGroupsForActiveList = collapseGroupsForActiveList;
  win.displayAlbums = displayAlbums;
  win.SuSheAppNavigation = {
    ...win.SuSheAppNavigation,
    openAlbum,
  };
}
