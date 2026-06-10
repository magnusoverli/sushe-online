// Late-bound list actions. app.js registers the implementations at startup,
// so lazily loaded modules can invoke them without importing the app entry.
const impl = {};

export function registerListActions(actions) {
  Object.assign(impl, actions);
}

export function saveList(...args) {
  return impl.saveList(...args);
}

export function selectList(...args) {
  return impl.selectList(...args);
}

export function displayAlbums(...args) {
  return impl.displayAlbums(...args);
}

export function fetchAndDisplayPlaycounts(...args) {
  return impl.fetchAndDisplayPlaycounts(...args);
}

export function selectRecommendations(...args) {
  return impl.selectRecommendations(...args);
}
