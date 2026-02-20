/**
 * SearchPage - Stub for future feature.
 * Wrapped in AppShell so the TabBar (including Settings) is available.
 */

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsDrawer } from '@/features/settings';

export function SearchPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <AppShell
        activeTab={settingsOpen ? 'settings' : 'search'}
        onSettingsClick={() => setSettingsOpen(true)}
        onSettingsClose={() => setSettingsOpen(false)}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h1 className="text-screen-title" style={{ marginBottom: '16px' }}>
              Search
            </h1>
            <p
              className="text-artist"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Coming soon
            </p>
          </div>
        </div>
      </AppShell>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
