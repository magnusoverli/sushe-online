import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openInTidal, syncPlaylistToTidal, checkTidalPlaylist } from '../tidal';

// Mock api-client
vi.mock('../api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api-client';

describe('tidal service', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restore original window.location after each test
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  describe('openInTidal', () => {
    function mockLocation() {
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, href: '' },
        writable: true,
        configurable: true,
      });
    }

    it('resolves album via API and opens deep link', async () => {
      vi.mocked(api.get).mockResolvedValue({ id: '12345' });
      mockLocation();

      await openInTidal('Radiohead', 'OK Computer');

      expect(api.get).toHaveBeenCalledWith(
        '/api/tidal/album?artist=Radiohead&album=OK%20Computer'
      );
      expect(window.location.href).toBe('tidal://album/12345');
    });

    it('encodes special characters in API query', async () => {
      vi.mocked(api.get).mockResolvedValue({ id: '67890' });
      mockLocation();

      await openInTidal('Björk', 'Début');

      expect(api.get).toHaveBeenCalledWith(
        `/api/tidal/album?artist=${encodeURIComponent('Björk')}&album=${encodeURIComponent('Début')}`
      );
      expect(window.location.href).toBe('tidal://album/67890');
    });

    it('throws when album is not found', async () => {
      vi.mocked(api.get).mockResolvedValue({ error: 'Not found' });

      await expect(openInTidal('Unknown', 'Album')).rejects.toThrow(
        'Not found'
      );
    });

    it('throws with default message when no id and no error', async () => {
      vi.mocked(api.get).mockResolvedValue({});

      await expect(openInTidal('Unknown', 'Album')).rejects.toThrow(
        'Album not found on Tidal'
      );
    });

    it('propagates API errors', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

      await expect(openInTidal('Radiohead', 'OK Computer')).rejects.toThrow(
        'Network error'
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
