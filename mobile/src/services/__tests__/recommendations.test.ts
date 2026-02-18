import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRecommendationYears,
  getRecommendations,
  getRecommendationStatus,
  addRecommendation,
  editReasoning,
  removeRecommendation,
  lockYear,
  unlockYear,
} from '../recommendations';

// Mock the api-client
vi.mock('../api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../api-client';
const mockApi = vi.mocked(api);

describe('recommendations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getRecommendationYears should call GET /api/recommendations/years', async () => {
    mockApi.get.mockResolvedValue({ years: [2024, 2023] });
    const result = await getRecommendationYears();
    expect(mockApi.get).toHaveBeenCalledWith('/api/recommendations/years');
    expect(result.years).toEqual([2024, 2023]);
  });

  it('getRecommendations should call GET /api/recommendations/:year', async () => {
    mockApi.get.mockResolvedValue({
      year: 2024,
      locked: false,
      recommendations: [],
    });
    const result = await getRecommendations(2024);
    expect(mockApi.get).toHaveBeenCalledWith('/api/recommendations/2024');
    expect(result.year).toBe(2024);
  });

  it('getRecommendationStatus should call GET /api/recommendations/:year/status', async () => {
    mockApi.get.mockResolvedValue({
      year: 2024,
      locked: false,
      hasAccess: true,
      count: 5,
    });
    const result = await getRecommendationStatus(2024);
    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/recommendations/2024/status'
    );
    expect(result.count).toBe(5);
  });

  it('addRecommendation should call POST /api/recommendations/:year', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      _id: 'r1',
      album_id: 'a1',
      year: 2024,
    });
    const album = { artist: 'Test', album: 'Album' };
    const result = await addRecommendation(2024, album, 'Great album');
    expect(mockApi.post).toHaveBeenCalledWith('/api/recommendations/2024', {
      album,
      reasoning: 'Great album',
    });
    expect(result.success).toBe(true);
  });

  it('editReasoning should call PATCH /api/recommendations/:year/:albumId/reasoning', async () => {
    mockApi.patch.mockResolvedValue({ success: true });
    await editReasoning(2024, 'album1', 'Updated reasoning');
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/api/recommendations/2024/album1/reasoning',
      { reasoning: 'Updated reasoning' }
    );
  });

  it('removeRecommendation should call DELETE /api/recommendations/:year/:albumId', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    await removeRecommendation(2024, 'album1');
    expect(mockApi.delete).toHaveBeenCalledWith(
      '/api/recommendations/2024/album1'
    );
  });

  it('lockYear should call POST /api/recommendations/:year/lock', async () => {
    mockApi.post.mockResolvedValue({ success: true, locked: true });
    const result = await lockYear(2024);
    expect(mockApi.post).toHaveBeenCalledWith('/api/recommendations/2024/lock');
    expect(result.locked).toBe(true);
  });

  it('unlockYear should call POST /api/recommendations/:year/unlock', async () => {
    mockApi.post.mockResolvedValue({ success: true, locked: false });
    const result = await unlockYear(2024);
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/recommendations/2024/unlock'
    );
    expect(result.locked).toBe(false);
  });
});
