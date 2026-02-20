import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateAccentColor,
  updateTimeFormat,
  updateDateFormat,
  updateMusicService,
  updateEmail,
  updateUsername,
  changePassword,
  requestAdmin,
  getSystemStats,
  getAdminStats,
  getAdminStatus,
  getAdminEvents,
  executeEventAction,
  makeAdmin,
  revokeAdmin,
  deleteUser,
} from '../settings';

// Mock the api-client
vi.mock('../api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api-client';
const mockApi = vi.mocked(api);

describe('settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Simple settings
  it('updateAccentColor should POST to /settings/update-accent-color', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateAccentColor('#ff0000');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/update-accent-color', {
      accentColor: '#ff0000',
    });
  });

  it('updateTimeFormat should POST to /settings/update-time-format', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateTimeFormat('12h');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/update-time-format', {
      timeFormat: '12h',
    });
  });

  it('updateDateFormat should POST to /settings/update-date-format', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateDateFormat('DD/MM/YYYY');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/update-date-format', {
      dateFormat: 'DD/MM/YYYY',
    });
  });

  it('updateMusicService should POST to /settings/update-music-service', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateMusicService('spotify');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/settings/update-music-service',
      { musicService: 'spotify' }
    );
  });

  it('updateMusicService should handle null value', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateMusicService(null);
    expect(mockApi.post).toHaveBeenCalledWith(
      '/settings/update-music-service',
      { musicService: null }
    );
  });

  // Unique field updates
  it('updateEmail should POST to /settings/update-email', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateEmail('new@example.com');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/update-email', {
      email: 'new@example.com',
    });
  });

  it('updateUsername should POST to /settings/update-username', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await updateUsername('newname');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/update-username', {
      username: 'newname',
    });
  });

  // Password
  it('changePassword should POST to /settings/change-password', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await changePassword({
      currentPassword: 'old',
      newPassword: 'new123',
      confirmPassword: 'new123',
    });
    expect(mockApi.post).toHaveBeenCalledWith('/settings/change-password', {
      currentPassword: 'old',
      newPassword: 'new123',
      confirmPassword: 'new123',
    });
  });

  // Admin access
  it('requestAdmin should POST to /settings/request-admin', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await requestAdmin('ADMIN_CODE');
    expect(mockApi.post).toHaveBeenCalledWith('/settings/request-admin', {
      code: 'ADMIN_CODE',
    });
  });

  // Stats
  it('getSystemStats should GET /api/stats', async () => {
    mockApi.get.mockResolvedValue({
      totalUsers: 10,
      totalLists: 50,
      totalAlbums: 500,
      adminUsers: 2,
      activeUsers: 5,
    });
    const result = await getSystemStats();
    expect(mockApi.get).toHaveBeenCalledWith('/api/stats');
    expect(result.totalUsers).toBe(10);
  });

  it('getAdminStats should GET /api/admin/stats', async () => {
    mockApi.get.mockResolvedValue({
      totalUsers: 10,
      users: [],
    });
    const result = await getAdminStats();
    expect(mockApi.get).toHaveBeenCalledWith('/api/admin/stats');
    expect(result.totalUsers).toBe(10);
  });

  it('getAdminStatus should GET /api/admin/status', async () => {
    mockApi.get.mockResolvedValue({ isAdmin: true, codeValid: true });
    const result = await getAdminStatus();
    expect(mockApi.get).toHaveBeenCalledWith('/api/admin/status');
    expect(result.isAdmin).toBe(true);
  });

  // Admin events
  it('getAdminEvents should GET /api/admin/events with params', async () => {
    mockApi.get.mockResolvedValue({ events: [], total: 0 });
    await getAdminEvents(10, 5);
    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/admin/events?limit=10&offset=5'
    );
  });

  it('executeEventAction should POST to /api/admin/events/:id/action/:action', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await executeEventAction('event1', 'approve');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/admin/events/event1/action/approve'
    );
  });

  // Admin user management
  it('makeAdmin should POST to /admin/make-admin', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await makeAdmin('user1');
    expect(mockApi.post).toHaveBeenCalledWith('/admin/make-admin', {
      userId: 'user1',
    });
  });

  it('revokeAdmin should POST to /admin/revoke-admin', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await revokeAdmin('user1');
    expect(mockApi.post).toHaveBeenCalledWith('/admin/revoke-admin', {
      userId: 'user1',
    });
  });

  it('deleteUser should POST to /admin/delete-user', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    await deleteUser('user1');
    expect(mockApi.post).toHaveBeenCalledWith('/admin/delete-user', {
      userId: 'user1',
    });
  });
});
