/**
 * ListFooter - "End of list" marker at the bottom of the album list.
 *
 * Design spec: DM Mono 10px caps, rgba(255,255,255,0.12), centered.
 */

interface ListFooterProps {
  albumCount: number;
}

export function ListFooter({ albumCount }: ListFooterProps) {
  return (
    <div
      style={{
        padding: '24px var(--space-list-x) 32px',
        textAlign: 'center',
      }}
      data-testid="list-footer"
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          fontWeight: 400,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.12)',
        }}
      >
        {albumCount} album{albumCount !== 1 ? 's' : ''} · end of list
      </span>
    </div>
  );
}
