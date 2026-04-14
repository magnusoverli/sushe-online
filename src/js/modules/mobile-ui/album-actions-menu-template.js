export function buildAlbumActionMenuHtml({
  album,
  hasAnyService,
  showSpotifyConnect,
  primaryServiceName,
  showRecommend,
  hasLastfm,
}) {
  return `

          <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
          <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
          
          <button data-action="edit"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
          </button>

          <!-- Expandable Play Section -->
          <div class="play-section">
            <button data-action="play-toggle"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm ${!hasAnyService ? 'opacity-50' : ''}">
              <span>
                <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
              </span>
              ${showSpotifyConnect ? '<i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-chevron></i>' : ''}
            </button>
            
            <!-- Expandable device list (hidden by default) -->
            <div data-play-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
                <!-- Open in app option -->
                <button data-action="open-app"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-external-link-alt mr-3 text-green-500 text-sm"></i>
                  <span class="text-sm">Open in ${primaryServiceName}</span>
                </button>
                
                ${
                  showSpotifyConnect
                    ? `
                <!-- Spotify Connect devices section -->
                <div class="mt-1 pt-1 border-t border-gray-800">
                  <div class="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wide">Spotify Connect</div>
                  <div data-device-list>
                    <div class="px-3 py-2 text-sm text-gray-400">
                      <i class="fas fa-spinner fa-spin mr-2"></i>Loading devices...
                    </div>
                  </div>
                </div>
                `
                    : ''
                }
              </div>
            </div>
          </div>

          <button data-action="move"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-arrow-right mr-3 text-gray-400"></i>Move to List...
          </button>

          <button data-action="copy"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-copy mr-3 text-gray-400"></i>Copy to List...
          </button>

          ${
            showRecommend
              ? `
          <button data-action="recommend"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-thumbs-up mr-3 text-blue-400"></i>Recommend
          </button>
          `
              : ''
          }

          ${
            hasLastfm
              ? `
          <!-- Last.fm Discovery Options -->
          <div class="border-t border-gray-700 my-2"></div>
          <button data-action="similar-artists"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-users mr-3 text-purple-400"></i>Show Similar Artists
          </button>
          <div class="border-t border-gray-700 my-2"></div>
          `
              : ''
          }

          <button data-action="remove"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Remove from List
          </button>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>
`;
}
