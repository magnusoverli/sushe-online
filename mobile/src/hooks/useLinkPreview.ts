/**
 * useLinkPreview - Fetches OG metadata for a URL via /api/unfurl.
 *
 * Returns { title, description, image } or null while loading/on error.
 * Caches results via React Query with a long staleTime.
 */

import { useQuery } from '@tanstack/react-query';
import { unfurlUrl } from '@/services/settings';

export interface LinkPreviewData {
  title: string;
  description: string;
  image: string;
}

export function useLinkPreview(url: string | null) {
  return useQuery<LinkPreviewData>({
    queryKey: ['link-preview', url],
    queryFn: () => unfurlUrl(url!),
    enabled: !!url,
    staleTime: 30 * 60_000, // 30 minutes
    retry: false,
  });
}
