import { describe, it, expect } from 'vitest';
import {
  normalizeForMatch,
  isAlbumMatchingPlayback,
  getDeviceIcon,
} from '../playback-utils';

describe('normalizeForMatch', () => {
  it('lowercases input', () => {
    expect(normalizeForMatch('Hello World')).toBe('hello world');
  });

  it('removes parenthetical suffixes', () => {
    expect(normalizeForMatch('OK Computer (Remastered)')).toBe('ok computer');
  });

  it('removes bracketed suffixes', () => {
    expect(normalizeForMatch('Loveless [Deluxe Edition]')).toBe('loveless');
  });

  it('removes remaster/deluxe tags after dash', () => {
    expect(normalizeForMatch('Abbey Road - Remastered')).toBe('abbey road');
  });

  it('removes expanded/anniversary tags', () => {
    expect(normalizeForMatch('In Rainbows - Anniversary Edition')).toBe(
      'in rainbows'
    );
  });

  it('normalizes whitespace', () => {
    expect(normalizeForMatch('  hello   world  ')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeForMatch('')).toBe('');
  });

  it('handles multiple parenthetical groups', () => {
    expect(normalizeForMatch('Screamadelica (Deluxe) (Bonus Tracks)')).toBe(
      'screamadelica'
    );
  });
});

describe('isAlbumMatchingPlayback', () => {
  it('returns false when playback names are null', () => {
    expect(
      isAlbumMatchingPlayback('OK Computer', 'Radiohead', null, null)
    ).toBe(false);
  });

  it('returns false when only album is null', () => {
    expect(
      isAlbumMatchingPlayback('OK Computer', 'Radiohead', null, 'Radiohead')
    ).toBe(false);
  });

  it('matches exact album and artist', () => {
    expect(
      isAlbumMatchingPlayback(
        'OK Computer',
        'Radiohead',
        'OK Computer',
        'Radiohead'
      )
    ).toBe(true);
  });

  it('matches with case differences', () => {
    expect(
      isAlbumMatchingPlayback(
        'OK Computer',
        'Radiohead',
        'ok computer',
        'radiohead'
      )
    ).toBe(true);
  });

  it('matches remastered variant on Spotify to plain album in list', () => {
    expect(
      isAlbumMatchingPlayback(
        'Loveless',
        'My Bloody Valentine',
        'Loveless (Remastered)',
        'My Bloody Valentine'
      )
    ).toBe(true);
  });

  it('returns false when artist does not match', () => {
    expect(
      isAlbumMatchingPlayback(
        'OK Computer',
        'Radiohead',
        'OK Computer',
        'Coldplay'
      )
    ).toBe(false);
  });

  it('returns false when album does not match', () => {
    expect(
      isAlbumMatchingPlayback('OK Computer', 'Radiohead', 'Kid A', 'Radiohead')
    ).toBe(false);
  });

  it('handles substring artist matching', () => {
    expect(
      isAlbumMatchingPlayback(
        'Some Album',
        'The Beatles',
        'Some Album',
        'Beatles'
      )
    ).toBe(true);
  });
});

describe('getDeviceIcon', () => {
  it('returns laptop icon for Computer', () => {
    expect(getDeviceIcon('Computer')).toBe('\uD83D\uDCBB');
  });

  it('returns phone icon for Smartphone', () => {
    expect(getDeviceIcon('Smartphone')).toBe('\uD83D\uDCF1');
  });

  it('returns speaker icon for Speaker', () => {
    expect(getDeviceIcon('Speaker')).toBe('\uD83D\uDD0A');
  });

  it('returns TV icon for TV', () => {
    expect(getDeviceIcon('TV')).toBe('\uD83D\uDCFA');
  });

  it('returns music note for unknown type', () => {
    expect(getDeviceIcon('Unknown')).toBe('\uD83C\uDFB5');
  });

  it('returns music note for null', () => {
    expect(getDeviceIcon(null)).toBe('\uD83C\uDFB5');
  });
});
