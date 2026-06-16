// Shared constants for the SuShe Online browser extension.

(function () {
  const STORAGE_KEYS = {
    API_URL: 'apiUrl',
    AUTH_TOKEN: 'authToken',
    TOKEN_EXPIRES_AT: 'tokenExpiresAt',
    USER_LISTS: 'userLists',
    USER_LISTS_BY_YEAR: 'userListsByYear',
    LISTS_LAST_FETCHED: 'listsLastFetched',
    HAS_EVER_AUTHENTICATED: 'hasEverAuthenticated',
    AUTO_REFRESH_SUPPORTED: 'autoRefreshSupported',
  };

  const LIST_CACHE_DURATION_MS = 60 * 1000;

  const MENU = {
    CONTEXTS: ['image', 'link'],
    DOCUMENT_URL_PATTERNS: ['*://*.rateyourmusic.com/*'],
    MAIN_ID: 'sushe-main',
    LIST_PREFIX: 'sushe-list-',
    NO_LISTS_ID: 'sushe-no-lists',
    WELCOME_ID: 'sushe-welcome',
    SETUP_ID: 'sushe-setup',
    ERROR_ID: 'sushe-error',
    LOGIN_ID: 'sushe-login',
    REFRESH_ID: 'sushe-refresh',
  };

  const ACTIONS = {
    EXTRACT_ALBUM_IDENTITY: 'extractAlbumIdentity',
    FETCH_GENRES_FOR_ALBUM: 'fetchGenresForAlbum',
    EXTRACT_ALBUM_DATA: 'extractAlbumData',
    REFRESH_LISTS: 'refreshLists',
    UPDATE_API_URL: 'updateApiUrl',
    GET_API_URL: 'getApiUrl',
    LOGOUT: 'logout',
    GET_AUTH_STATUS: 'getAuthStatus',
    GET_POPUP_STATE: 'getPopupState',
    GET_LISTS: 'getLists',
    RYM_PAGE_LOADED: 'rymPageLoaded',
  };

  const API = {
    LISTS: '/api/lists',
    MUSICBRAINZ_PROXY: '/api/proxy/musicbrainz',
    EXTENSION_AUTH: '/extension/auth',
  };

  const NOTIFICATIONS = {
    WELCOME_ID: 'sushe-welcome',
  };

  globalThis.ExtensionConstants = {
    STORAGE_KEYS,
    LIST_CACHE_DURATION_MS,
    MENU,
    ACTIONS,
    API,
    NOTIFICATIONS,
  };
})();
