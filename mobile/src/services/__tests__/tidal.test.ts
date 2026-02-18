import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInTidal, syncPlaylistToTidal, checkTidalPlaylist } from '../tidal';

// Mock api-client
vi.mock('../api-client', () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from '../api-client';

describe('tidal service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('openInTidal', () => {
    it('opens Tidal search URL in new tab', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      openInTidal('Radiohead', 'OK Computer');
      expect(openSpy).toHaveBeenCalledWith(
        'https://tidal.com/search?q=Radiohead%20OK%20Computer',
        '_blank'
      );
    });

    it('encodes special characters in search query', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      openInTidal('Björk', 'Début');
      expect(openSpy).toHaveBeenCalledWith(
        `https://tidal.com/search?q=${encodeURIComponent('Björk Début')}`,
        '_blank'
      );
    });
  });

  describe('syncPlaylistToTidal', () => {
    it('calls POST /api/playlists/:listId with service=tidal', async () => {
      vi.mocked(api.post).mockResolvedValue({ success: true });
      const result = await syncPlaylistToTidal('list-123');
      expect(api.post).toHaveBeenCalledWith('/api/playlists/list-123', {
        service: 'tidal',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('checkTidalPlaylist', () => {
    it('calls POST /api/playlists/:listId with action=check and service=tidal', async () => {
      vi.mocked(api.post).mockResolvedValue({
        exists: true,
        playlistName: 'My List',
      });
      const result = await checkTidalPlaylist('list-456');
      expect(api.post).toHaveBeenCalledWith('/api/playlists/list-456', {
        action: 'check',
        service: 'tidal',
      });
      expect(result).toEqual({ exists: true, playlistName: 'My List' });
    });
  });
});
