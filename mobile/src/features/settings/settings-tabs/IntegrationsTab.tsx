/**
 * IntegrationsTab - Spotify, Tidal, Last.fm connect/disconnect
 * and default music service selection.
 *
 * Service connect/disconnect uses full page redirects (OAuth flows).
 * To return to the mobile SPA after the OAuth redirect, we pass
 * ?returnTo=/mobile as a query parameter.
 */

import { useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';
import { useUpdateMusicService } from '@/hooks/useSettings';
import {
  sectionStyle,
  sectionTitleStyle,
  fieldRowStyle,
  fieldLabelStyle,
  fieldValueStyle,
  buttonStyle,
} from './shared-styles';

export function IntegrationsTab() {
  const user = useAppStore((s) => s.user);
  const musicServiceMutation = useUpdateMusicService();

  const handleConnect = useCallback((service: string) => {
    window.location.href = `/auth/${service}?returnTo=/mobile`;
  }, []);

  const handleDisconnect = useCallback((service: string) => {
    window.location.href = `/auth/${service}/disconnect?returnTo=/mobile`;
  }, []);

  const handleMusicServiceChange = useCallback(
    (value: string) => {
      musicServiceMutation.mutate(value || null);
    },
    [musicServiceMutation]
  );

  if (!user) return null;

  return (
    <div style={{ padding: '16px 12px' }}>
      {/* Spotify */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Spotify</div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Status</span>
          <span
            style={{
              ...fieldValueStyle,
              color: user.spotifyConnected
                ? '#1DB954'
                : 'rgba(255,255,255,0.35)',
            }}
          >
            {user.spotifyConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {user.spotifyConnected ? (
            <>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => handleConnect('spotify')}
              >
                Reauthorize
              </button>
              <button
                type="button"
                style={{
                  ...buttonStyle,
                  background: 'rgba(224,92,92,0.15)',
                  color: 'var(--color-destructive)',
                }}
                onClick={() => handleDisconnect('spotify')}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: '#1DB954',
                color: '#fff',
              }}
              onClick={() => handleConnect('spotify')}
            >
              Connect Spotify
            </button>
          )}
        </div>
      </div>

      {/* Tidal */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Tidal</div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Status</span>
          <span
            style={{
              ...fieldValueStyle,
              color: user.tidalConnected ? '#00FFFF' : 'rgba(255,255,255,0.35)',
            }}
          >
            {user.tidalConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {user.tidalConnected ? (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: 'rgba(224,92,92,0.15)',
                color: 'var(--color-destructive)',
              }}
              onClick={() => handleDisconnect('tidal')}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: 'rgba(0,255,255,0.15)',
                color: '#00FFFF',
              }}
              onClick={() => handleConnect('tidal')}
            >
              Connect Tidal
            </button>
          )}
        </div>
      </div>

      {/* Last.fm */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Last.fm</div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Status</span>
          <span
            style={{
              ...fieldValueStyle,
              color: user.lastfmConnected
                ? '#D51007'
                : 'rgba(255,255,255,0.35)',
            }}
          >
            {user.lastfmConnected
              ? `Connected (${user.lastfmUsername ?? 'unknown'})`
              : 'Not connected'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {user.lastfmConnected ? (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: 'rgba(224,92,92,0.15)',
                color: 'var(--color-destructive)',
              }}
              onClick={() => handleDisconnect('lastfm')}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: 'rgba(213,16,7,0.15)',
                color: '#D51007',
              }}
              onClick={() => handleConnect('lastfm')}
            >
              Connect Last.fm
            </button>
          )}
        </div>
      </div>

      {/* Default music service */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Default Music Service</div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            marginBottom: '8px',
          }}
        >
          Used for album playback and links
        </div>
        <select
          value={user.musicService ?? ''}
          onChange={(e) => handleMusicServiceChange(e.target.value)}
          disabled={musicServiceMutation.isPending}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '16px',
            appearance: 'auto' as never,
          }}
        >
          <option value="">Ask each time</option>
          <option value="spotify">Spotify</option>
          <option value="tidal">Tidal</option>
        </select>
      </div>
    </div>
  );
}
