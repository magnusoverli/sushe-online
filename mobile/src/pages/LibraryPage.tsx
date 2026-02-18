/**
 * LibraryPage - Main album list view. Placeholder for Phase 4.
 */

export function LibraryPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-frame)',
        padding: '24px',
      }}
    >
      <h1 className="text-screen-title" style={{ marginBottom: '16px' }}>
        Library
      </h1>
      <p
        className="text-artist"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Album list view — Phase 4
      </p>
    </div>
  );
}
