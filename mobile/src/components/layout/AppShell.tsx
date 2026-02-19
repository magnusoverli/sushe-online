/**
 * AppShell - Top-level layout with scrollable content area, optional
 * NowPlayingBar, and sticky TabBar.
 *
 * Structure:
 * ┌──────────────────────┐
 * │  scrollable content   │ ← flex: 1, overflow-y auto
 * │                       │
 * │                       │
 * ├──────────────────────┤
 * │  NowPlayingBar        │ ← conditional, 64px
 * ├──────────────────────┤
 * │  TabBar (sticky)      │ ← 64px + safe area
 * └──────────────────────┘
 */

import type { ReactNode, Ref } from 'react';
import { TabBar, type TabId } from '@/components/ui/TabBar';
import { NowPlayingBar } from '@/components/player/NowPlayingBar';

interface AppShellProps {
  activeTab: TabId;
  children: ReactNode;
  /** Ref to the scrollable content area (for auto-scroll during drag). */
  scrollRef?: Ref<HTMLElement | null>;
  /** Whether the NowPlayingBar should be visible. */
  showNowPlaying?: boolean;
  /** Called when the Settings tab is tapped in the TabBar. */
  onSettingsClick?: () => void;
}

export function AppShell({
  activeTab,
  children,
  scrollRef,
  showNowPlaying = false,
  onSettingsClick,
}: AppShellProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(var(--vh, 1vh) * 100)',
        background: 'var(--color-frame)',
        overflow: 'hidden',
      }}
      data-testid="app-shell"
    >
      <main
        ref={scrollRef}
        className="hide-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
        data-testid="app-shell-content"
      >
        {children}
      </main>
      <NowPlayingBar visible={showNowPlaying} />
      <TabBar activeTab={activeTab} onSettingsClick={onSettingsClick} />
    </div>
  );
}
