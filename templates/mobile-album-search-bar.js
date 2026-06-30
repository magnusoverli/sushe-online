/**
 * Mobile album-search bar markup — morphs over the header when search opens.
 *
 * Kept in its own module so templates/auth-templates.js stays within the
 * maintainability file-size budget. The behaviour (open/close, search,
 * results, jump-to-album) lives in src/js/modules/mobile-album-search.js; the
 * appearance lives in public/styles/app.css under `.album-search-mobile-*`.
 */
const mobileAlbumSearchBarTemplate = () => `
      <!-- Mobile album search bar: morphs over the header when search is open -->
      <div id="mobileAlbumSearchBar" role="search" class="album-search-mobile-bar lg:hidden absolute inset-0 z-10 hidden items-center gap-2 px-3">
        <button id="mobileAlbumSearchBack" type="button" aria-label="Close search" class="p-2 -m-2 text-gray-300 active:text-white touch-target">
          <i class="fas fa-arrow-left text-lg"></i>
        </button>
        <div class="relative flex-1 min-w-0">
          <input
            id="mobileAlbumSearchInput"
            type="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Search your albums…"
            aria-label="Search albums across your lists"
            role="combobox"
            aria-expanded="true"
            aria-controls="mobileAlbumSearchResults"
            aria-autocomplete="list"
            class="album-search-mobile-input"
          />
          <button id="mobileAlbumSearchClear" type="button" aria-label="Clear search" class="absolute right-0 top-1/2 hidden -translate-y-1/2 flex items-center justify-center px-3 text-gray-500 active:text-gray-200 touch-target">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <button id="mobileAlbumSearchOptionsBtn" type="button" aria-label="Choose which fields to search" aria-haspopup="dialog" class="p-2 -m-1 text-gray-300 active:text-white touch-target">
          <i class="fas fa-sliders-h text-lg"></i>
        </button>
      </div>
      `;

module.exports = { mobileAlbumSearchBarTemplate };
