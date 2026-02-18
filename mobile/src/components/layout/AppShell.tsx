/**
 * AppShell - Top-level layout with scrollable content area and sticky TabBar.
 *
 * Structure:
 * ┌──────────────────────┐
 * │  scrollable content   │ ← flex: 1, overflow-y auto
 * │                       │
 * │                       │
 * ├──────────────────────┤
 * │  TabBar (sticky)      │ ← 64px + safe area
 * └──────────────────────┘
 */

import type { ReactNode, Ref } from 'react';
import { TabBar, type TabId } from '@/components/ui/TabBar';

interface AppShellProps {
  activeTab: TabId;
  children: ReactNode;
  /** Ref to the scrollable content area (for auto-scroll during drag). */
  scrollRef?: Ref<HTMLElement | null>;
}

export function AppShell({ activeTab, children, scrollRef }: AppShellProps) {
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
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
        data-testid="app-shell-content"
      >
        {children}
      </main>
      <TabBar activeTab={activeTab} />
    </div>
  );
}
