/**
 * TabBar - Persistent bottom navigation.
 *
 * Spec (page 10):
 * - Position: sticky bottom 0 inside phone frame
 * - Height: 64px + safe area
 * - Background: #0E0E12
 * - Top border: 1px solid rgba(255,255,255,0.06)
 * - Z-index: 100
 * - 3 tabs: Library, Search, Settings
 * - Icons: outline SVG, 20x20px, stroke-width 1.5
 * - Labels: DM Mono 7.5px, +0.06em
 * - Active: stroke #E8C87A, label #E8C87A weight 500, 4px gold dot below label
 * - Default: stroke rgba(255,255,255,0.30), label rgba(255,255,255,0.30)
 */

import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Library, Search, Settings } from 'lucide-react';

export type TabId = 'library' | 'search' | 'settings';

interface TabDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  /** Route path — omitted for tabs that fire a callback instead of navigating. */
  path?: string;
}

const TABS: TabDef[] = [
  {
    id: 'library',
    label: 'Library',
    icon: <Library size={20} strokeWidth={1.5} />,
    path: '/',
  },
  {
    id: 'search',
    label: 'Search',
    icon: <Search size={20} strokeWidth={1.5} />,
    path: '/search',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={20} strokeWidth={1.5} />,
    // No path — handled via onSettingsClick callback
  },
];

interface TabBarProps {
  activeTab: TabId;
  /** Called when the Settings tab is tapped. */
  onSettingsClick?: () => void;
}

const barStyle: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  zIndex: 'var(--z-tabbar)' as unknown as number,
  display: 'flex',
  minHeight: 'var(--tabbar-height)',
  background: 'var(--tabbar-bg)',
  borderTop: '1px solid var(--tabbar-border)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  touchAction: 'none',
};

const tabItemStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  paddingTop: '10px',
  paddingBottom: '12px',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  position: 'relative',
};

const labelBase: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '7.5px',
  letterSpacing: '0.06em',
  lineHeight: 1,
};

const dotStyle: CSSProperties = {
  width: '4px',
  height: '4px',
  borderRadius: '50%',
  position: 'absolute',
  bottom: '0px',
};

export function TabBar({ activeTab, onSettingsClick }: TabBarProps) {
  const navigate = useNavigate();

  return (
    <nav style={barStyle} role="tablist" data-testid="tab-bar">
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const color = isActive ? 'var(--color-gold)' : 'rgba(255,255,255,0.30)';

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            style={{ ...tabItemStyle, color }}
            onClick={() => {
              if (tab.id === 'settings') {
                onSettingsClick?.();
              } else if (tab.path) {
                navigate({ to: tab.path });
              }
            }}
            data-testid={`tab-${tab.id}`}
          >
            {tab.icon}
            <span
              style={{
                ...labelBase,
                color,
                fontWeight: isActive ? 500 : 400,
              }}
            >
              {tab.label}
            </span>
            {/* Active dot */}
            <span
              style={{
                ...dotStyle,
                background: isActive ? 'var(--color-gold)' : 'transparent',
              }}
            />
          </button>
        );
      })}
    </nav>
  );
}
