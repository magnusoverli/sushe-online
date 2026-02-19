/**
 * AppShell - Top-level layout with optional fixed header, scrollable
 * content area, optional NowPlayingBar, and sticky TabBar.
 *
 * Structure:
 * ┌──────────────────────┐
 * │  header (fixed)       │ ← optional, never scrolls
 * ├──────────────────────┤
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
  /** Fixed header rendered above the scrollable area (like TabBar at bottom). */
  header?: ReactNode;
  /** Ref to the scrollable content area (for auto-scroll during drag). */
  scrollRef?: Ref<HTMLElement | null>;
  /** Whether the NowPlayingBar should be visible. */
  showNowPlaying?: boolean;
  /** Called when the Settings tab is tapped in the TabBar. */
  onSettingsClick?: () => void;
  /** Skip auto safe-area-inset-top on main (when a sticky child handles it). */
  skipSafeArea?: boolean;
}

export function AppShell({
  activeTab,
  children,
  header,
  scrollRef,
  showNowPlaying = false,
  onSettingsClick,
  skipSafeArea = false,
}: AppShellProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(var(--vh, 1vh) * 100)',
        background: 'var(--color-frame)',
        overflow: 'hidden',
        overscrollBehavior: 'none',
      }}
      data-testid="app-shell"
    >
      {header && (
        <div
          style={{
            flexShrink: 0,
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
          data-testid="app-shell-header"
        >
          {header}
        </div>
      )}
      <main
        ref={scrollRef}
        className="hide-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          ...(!header && !skipSafeArea
            ? { paddingTop: 'env(safe-area-inset-top, 0px)' }
            : {}),
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
