import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  api,
  setCsrfToken,
  getCsrfToken,
  ApiRequestError,
} from '../api-client';

describe('api-client', () => {
  beforeEach(() => {
    setCsrfToken('');
    vi.restoreAllMocks();
  });

  describe('setCsrfToken / getCsrfToken', () => {
    it('stores and retrieves CSRF token', () => {
      setCsrfToken('test-token-123');
      expect(getCsrfToken()).toBe('test-token-123');
    });
  });

  describe('api.get', () => {
    it('makes GET request with credentials', async () => {
      const mockResponse = { data: 'test' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await api.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'GET',
          credentials: 'same-origin',
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('api.post', () => {
    it('sends JSON body with CSRF token', async () => {
      setCsrfToken('csrf-abc');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await api.post('/api/test', { key: 'value' });

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
          headers: expect.objectContaining({
            'X-CSRF-Token': 'csrf-abc',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('does not send CSRF token when not set', async () => {
      setCsrfToken('');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await api.post('/api/test', {});

      const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
        ?.headers as Record<string, string>;
      expect(callHeaders['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws ApiRequestError on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await api.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiRequestError);
        expect((e as ApiRequestError).message).toBe('Unauthorized');
        expect((e as ApiRequestError).status).toBe(401);
      }
    });

    it('includes status code in error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await api.get('/api/test');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiRequestError);
        expect((e as ApiRequestError).status).toBe(404);
      }
    });

    it('extracts message from nested error object (sendErrorResponse format)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { message: 'Invalid CSRF token', code: 'FORBIDDEN' },
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      try {
        await api.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiRequestError);
        expect((e as ApiRequestError).message).toBe('Invalid CSRF token');
        expect((e as ApiRequestError).status).toBe(403);
      }
    });

    it('falls back to generic message when error has no extractable message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ something: 'unexpected' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await api.get('/api/test');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiRequestError);
        expect((e as ApiRequestError).message).toBe(
          'Request failed with status 500'
        );
      }
    });
  });
});
