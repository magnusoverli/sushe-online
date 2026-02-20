import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reorderGroups, reorderListsInGroup } from '../groups';

describe('groups service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('reorderGroups', () => {
    it('sends POST to /api/groups/reorder with order array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await reorderGroups(['group-1', 'group-2', 'group-3']);

      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/groups/reorder');
      expect(options?.method).toBe('POST');
      const body = JSON.parse(options?.body as string);
      expect(body.order).toEqual(['group-1', 'group-2', 'group-3']);
    });
  });

  describe('reorderListsInGroup', () => {
    it('sends POST to /api/lists/reorder with groupId and order', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await reorderListsInGroup('group-1', ['list-a', 'list-b']);

      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toContain('/api/lists/reorder');
      expect(options?.method).toBe('POST');
      const body = JSON.parse(options?.body as string);
      expect(body.groupId).toBe('group-1');
      expect(body.order).toEqual(['list-a', 'list-b']);
    });
  });
});
