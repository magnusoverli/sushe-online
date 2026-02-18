/**
 * Import Service - Import lists from JSON files.
 *
 * Handles reading JSON files and creating lists via the API.
 */

import { createList, type CreateListRequest } from './lists';
import type { Album } from '@/lib/types';

export interface ImportMetadata {
  list_name?: string;
  year?: number;
  group_id?: string;
}

interface ImportData {
  _metadata?: ImportMetadata;
  albums?: Partial<Album>[];
}

export interface ImportResult {
  listId: string;
  listName: string;
  albumCount: number;
}

/**
 * Parse and clean imported album data.
 * Removes fields that shouldn't be imported (rank, points, _id).
 */
function cleanAlbums(albums: Partial<Album>[]): Partial<Album>[] {
  return albums.map((album) => {
    const cleaned = { ...album };
    delete (cleaned as Record<string, unknown>).points;
    delete (cleaned as Record<string, unknown>).rank;
    delete cleaned._id;
    return cleaned;
  });
}

/**
 * Read a JSON file and return parsed import data.
 */
export async function readImportFile(file: File): Promise<{
  name: string;
  albums: Partial<Album>[];
  metadata: ImportMetadata | null;
}> {
  const text = await file.text();
  const parsed: ImportData | Partial<Album>[] = JSON.parse(text);

  // Support two formats:
  // Old format: bare array of albums
  // New format: { _metadata: {...}, albums: [...] }
  if (Array.isArray(parsed)) {
    const name = file.name.replace(/\.json$/i, '');
    return { name, albums: cleanAlbums(parsed), metadata: null };
  }

  const albums = cleanAlbums(parsed.albums || []);
  const name = parsed._metadata?.list_name || file.name.replace(/\.json$/i, '');
  const metadata = parsed._metadata || null;

  return { name, albums, metadata };
}

/**
 * Find the next available name by appending a number suffix.
 * E.g. "My List" -> "My List (2)", "My List (2)" -> "My List (3)"
 */
export function generateUniqueName(
  baseName: string,
  existingNames: Set<string>
): string {
  if (!existingNames.has(baseName)) return baseName;
  let n = 2;
  while (existingNames.has(`${baseName} (${n})`)) {
    n++;
  }
  return `${baseName} (${n})`;
}

/**
 * Import a list from parsed data.
 */
export async function importList(
  name: string,
  albums: Partial<Album>[],
  metadata: ImportMetadata | null
): Promise<ImportResult> {
  const req: CreateListRequest = {
    name,
    data: albums as Album[],
  };

  if (metadata?.year) req.year = metadata.year;
  if (metadata?.group_id) req.groupId = metadata.group_id;

  const result = await createList(req);

  return {
    listId: result._id,
    listName: result.name,
    albumCount: result.count,
  };
}
