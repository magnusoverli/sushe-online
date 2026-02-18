/**
 * StatsTab - Personal and system statistics.
 */

import { useSystemStats } from '@/hooks/useSettings';
import { useAppStore } from '@/stores/app-store';
import {
  sectionStyle,
  sectionTitleStyle,
  statCardStyle,
  statValueStyle,
  statLabelStyle,
  statsGridStyle,
} from './shared-styles';

export function StatsTab() {
  const user = useAppStore((s) => s.user);
  const listsMetadata = useAppStore((s) => s.listsMetadata);
  const { data: stats, isLoading } = useSystemStats();

  const personalListCount = Object.keys(listsMetadata).length;
  const personalAlbumCount = Object.values(listsMetadata).reduce(
    (sum, l) => sum + (l.count ?? 0),
    0
  );

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Personal stats */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Personal</div>
        <div style={statsGridStyle}>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{personalListCount}</div>
            <div style={statLabelStyle}>Lists</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{personalAlbumCount}</div>
            <div style={statLabelStyle}>Albums</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>
              {user?.role === 'admin' ? 'Admin' : 'User'}
            </div>
            <div style={statLabelStyle}>Role</div>
          </div>
        </div>
      </div>

      {/* System stats */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>System</div>
        {isLoading ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
              padding: '12px 0',
            }}
          >
            Loading statistics...
          </div>
        ) : stats ? (
          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{stats.totalUsers}</div>
              <div style={statLabelStyle}>Users</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{stats.totalLists}</div>
              <div style={statLabelStyle}>Lists</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{stats.totalAlbums}</div>
              <div style={statLabelStyle}>Albums</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{stats.adminUsers}</div>
              <div style={statLabelStyle}>Admins</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{stats.activeUsers}</div>
              <div style={statLabelStyle}>Active (7d)</div>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
              padding: '12px 0',
            }}
          >
            Failed to load statistics
          </div>
        )}
      </div>
    </div>
  );
}
