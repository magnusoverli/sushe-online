/**
 * PreferencesTab - Music preferences, affinities, and external service data.
 *
 * Displays top genres/artists/countries from internal lists,
 * genre/artist affinity scores, and Spotify/Last.fm data
 * with client-side time-range toggles.
 */

import { type CSSProperties, useState, useMemo } from 'react';
import { usePreferences, useSyncPreferences } from '@/hooks/usePreferences';
import type {
  PreferencesData,
  SpotifyArtistItem,
  SpotifyTrackItem,
  LastfmArtistItem,
  AffinityItem,
} from '@/lib/types';
import {
  sectionStyle,
  sectionTitleStyle,
  buttonStyle,
  statsGridStyle,
  statCardStyle,
  statValueStyle,
  statLabelStyle,
} from './shared-styles';

// ── Source color constants ──

const SOURCE_COLORS: Record<string, string> = {
  spotify: '#1DB954',
  lastfm: '#D51007',
  lists: 'var(--color-gold)',
};

// ── Spotify / Last.fm time-range labels ──

const SPOTIFY_RANGES: { key: string; label: string }[] = [
  { key: 'short_term', label: '4 Weeks' },
  { key: 'medium_term', label: '6 Months' },
  { key: 'long_term', label: 'All Time' },
];

const LASTFM_RANGES: { key: string; label: string }[] = [
  { key: '7day', label: '7 Days' },
  { key: '1month', label: '1 Month' },
  { key: '3month', label: '3 Months' },
  { key: '6month', label: '6 Months' },
  { key: '12month', label: '1 Year' },
  { key: 'overall', label: 'All Time' },
];

// ── Inline styles ──

const loadingStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--color-text-secondary)',
  padding: '12px 0',
};

const rankNumberStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  color: 'var(--color-text-label)',
  width: '18px',
  flexShrink: 0,
};

const itemNameStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'rgba(255,255,255,0.75)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 0',
};

const dotStyle = (color: string): CSSProperties => ({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

const toggleBarStyle: CSSProperties = {
  display: 'flex',
  gap: '6px',
  marginBottom: '10px',
  flexWrap: 'wrap',
};

const toggleButtonStyle = (active: boolean): CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  padding: '10px 12px',
  borderRadius: '6px',
  border: 'none',
  background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
});

const progressBarBg: CSSProperties = {
  height: '4px',
  borderRadius: '2px',
  background: 'rgba(255,255,255,0.06)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

const subTextStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  color: 'var(--color-text-secondary)',
};

const syncButtonStyle: CSSProperties = {
  ...buttonStyle,
  width: '100%',
  textAlign: 'center',
  marginTop: '8px',
};

const updatedAtStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  color: 'var(--color-text-secondary)',
  textAlign: 'center',
  marginTop: '12px',
};

// ── Helpers ──

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function countSources(data: PreferencesData): number {
  let count = 1; // internal lists always
  if (data.spotify) count++;
  if (data.lastfm) count++;
  return count;
}

// ── Sub-components ──

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <span style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
      {sources.map((s) => (
        <span key={s} style={dotStyle(SOURCE_COLORS[s] ?? '#888')} />
      ))}
    </span>
  );
}

function RankedList({
  items,
  limit,
  showSources,
}: {
  items: { name: string; count: number; points: number }[];
  limit: number;
  showSources?: boolean;
}) {
  const visible = items.slice(0, limit);
  if (visible.length === 0) {
    return <div style={loadingStyle}>No data</div>;
  }
  return (
    <div>
      {visible.map((item, i) => (
        <div key={item.name} style={itemRowStyle}>
          <span style={rankNumberStyle}>{i + 1}</span>
          <span style={itemNameStyle}>{item.name}</span>
          {showSources && (
            <SourceDots
              sources={
                item.points > 0 ? ['lists'] : ['spotify', 'lastfm', 'lists']
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function CountryList({
  items,
  limit,
}: {
  items: { name: string; count: number; points: number }[];
  limit: number;
}) {
  const visible = items.slice(0, limit);
  const maxCount = visible.length > 0 ? (visible[0]?.count ?? 1) : 1;
  if (visible.length === 0) {
    return <div style={loadingStyle}>No data</div>;
  }
  return (
    <div>
      {visible.map((item) => (
        <div key={item.name} style={{ ...itemRowStyle, gap: '8px' }}>
          <span style={{ ...itemNameStyle, flex: 'none', width: '80px' }}>
            {item.name}
          </span>
          <div style={progressBarBg}>
            <div
              style={{
                height: '100%',
                borderRadius: '2px',
                background: 'var(--color-gold)',
                width: `${(item.count / maxCount) * 100}%`,
                transition: 'width 300ms ease',
              }}
            />
          </div>
          <span style={subTextStyle}>{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function AffinityList({
  items,
  limit,
}: {
  items: AffinityItem[];
  limit: number;
}) {
  const visible = items.slice(0, limit);
  if (visible.length === 0) {
    return <div style={loadingStyle}>No data</div>;
  }
  return (
    <div>
      {visible.map((item) => (
        <div key={item.name} style={itemRowStyle}>
          <span style={itemNameStyle}>{item.name}</span>
          <SourceDots sources={item.sources} />
          <span style={subTextStyle}>{Math.round(item.score * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function SpotifySection({
  data,
}: {
  data: NonNullable<PreferencesData['spotify']>;
}) {
  const [range, setRange] = useState('short_term');

  const artists = useMemo(
    () => (data.topArtists[range] ?? []) as SpotifyArtistItem[],
    [data.topArtists, range]
  );
  const tracks = useMemo(
    () => (data.topTracks[range] ?? []) as SpotifyTrackItem[],
    [data.topTracks, range]
  );

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Spotify Top Artists & Tracks</div>
      <div style={toggleBarStyle}>
        {SPOTIFY_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            style={toggleButtonStyle(range === r.key)}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {artists.length > 0 && (
        <>
          <div style={{ ...subTextStyle, marginBottom: '4px' }}>Artists</div>
          {artists.slice(0, 8).map((a, i) => (
            <div key={`${a.name}-${i}`} style={itemRowStyle}>
              <span style={rankNumberStyle}>{i + 1}</span>
              <span style={itemNameStyle}>
                {a.name}
                {a.genres && a.genres.length > 0 && (
                  <span style={{ color: 'var(--color-text-label)' }}>
                    {' '}
                    ({a.genres.slice(0, 2).join(', ')})
                  </span>
                )}
              </span>
            </div>
          ))}
        </>
      )}

      {tracks.length > 0 && (
        <>
          <div
            style={{ ...subTextStyle, marginTop: '8px', marginBottom: '4px' }}
          >
            Tracks
          </div>
          {tracks.slice(0, 8).map((t, i) => (
            <div key={`${t.name}-${t.artist}-${i}`} style={itemRowStyle}>
              <span style={rankNumberStyle}>{i + 1}</span>
              <span style={itemNameStyle}>
                {t.name}
                <span style={{ color: 'rgba(255,255,255,0.30)' }}>
                  {' '}
                  — {t.artist}
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      {artists.length === 0 && tracks.length === 0 && (
        <div style={loadingStyle}>No data for this range</div>
      )}
    </div>
  );
}

function LastfmSection({
  data,
}: {
  data: NonNullable<PreferencesData['lastfm']>;
}) {
  const [range, setRange] = useState('overall');

  const artists = useMemo(
    () => (data.topArtists[range] ?? []) as LastfmArtistItem[],
    [data.topArtists, range]
  );

  const maxPlaycount = useMemo(
    () => (artists.length > 0 ? (artists[0]?.playcount ?? 1) : 1),
    [artists]
  );

  return (
    <>
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Last.fm Top Artists</div>
        <div style={toggleBarStyle}>
          {LASTFM_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              style={toggleButtonStyle(range === r.key)}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {artists.length > 0 ? (
          artists.slice(0, 8).map((a, i) => (
            <div key={`${a.name}-${i}`} style={{ ...itemRowStyle, gap: '8px' }}>
              <span style={rankNumberStyle}>{i + 1}</span>
              <span style={{ ...itemNameStyle, flex: 'none', width: '90px' }}>
                {a.name}
              </span>
              <div style={progressBarBg}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: '2px',
                    background:
                      'linear-gradient(90deg, #D51007 0%, #ff4444 100%)',
                    width: `${(a.playcount / maxPlaycount) * 100}%`,
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
              <span style={subTextStyle}>{a.playcount.toLocaleString()}</span>
            </div>
          ))
        ) : (
          <div style={loadingStyle}>No data for this range</div>
        )}
      </div>

      {/* Last.fm Stats */}
      {data.totalScrobbles > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Last.fm Stats</div>
          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>
                {data.totalScrobbles.toLocaleString()}
              </div>
              <div style={statLabelStyle}>Scrobbles</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main component ──

export function PreferencesTab() {
  const { data, isLoading } = usePreferences();
  const syncMutation = useSyncPreferences();

  if (isLoading) {
    return (
      <div style={{ padding: '16px 12px' }}>
        <div style={loadingStyle} data-testid="preferences-loading">
          Loading preferences...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '16px 12px' }} data-testid="preferences-empty">
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            padding: '24px 0 12px',
          }}
        >
          No preferences data. Tap Sync Now to generate.
        </div>
        <button
          type="button"
          style={syncButtonStyle}
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="preferences-sync"
        >
          {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    );
  }

  const sources = countSources(data);

  return (
    <div style={{ padding: '16px 12px' }} data-testid="preferences-content">
      {/* Quick Stats */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Quick Stats</div>
        <div style={statsGridStyle}>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{data.totalAlbums}</div>
            <div style={statLabelStyle}>Albums</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{data.topGenres.length}</div>
            <div style={statLabelStyle}>Genres</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{data.topArtists.length}</div>
            <div style={statLabelStyle}>Artists</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{sources}</div>
            <div style={statLabelStyle}>Sources</div>
          </div>
        </div>
      </div>

      {/* Top Genres */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Top Genres</div>
        <RankedList items={data.topGenres} limit={8} showSources />
      </div>

      {/* Top Artists */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Top Artists</div>
        <RankedList items={data.topArtists} limit={8} showSources />
      </div>

      {/* Top Countries */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Top Countries</div>
        <CountryList items={data.topCountries} limit={6} />
      </div>

      {/* Genre Affinity */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Genre Affinity</div>
        <AffinityList items={data.affinity.genres} limit={10} />
      </div>

      {/* Artist Affinity */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Artist Affinity</div>
        <AffinityList items={data.affinity.artists} limit={10} />
      </div>

      {/* Spotify section */}
      {data.spotify && <SpotifySection data={data.spotify} />}

      {/* Last.fm section */}
      {data.lastfm && <LastfmSection data={data.lastfm} />}

      {/* Sync button */}
      <button
        type="button"
        style={syncButtonStyle}
        onClick={() => syncMutation.mutate()}
        disabled={syncMutation.isPending}
        data-testid="preferences-sync"
      >
        {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
      </button>

      {/* Updated timestamp */}
      <div style={updatedAtStyle}>Updated {relativeTime(data.updatedAt)}</div>
    </div>
  );
}
