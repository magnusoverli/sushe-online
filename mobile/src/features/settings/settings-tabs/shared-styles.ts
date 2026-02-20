/**
 * Shared styles for settings tabs.
 *
 * Aligned with the gold standard text-size / colour tiers
 * established in the navigation drawer and AlbumActionSheet:
 *
 *   Title          17px  --font-display   --color-text-primary
 *   Action label   13px  --font-mono      rgba(255,255,255,0.75)
 *   Button         12px  --font-mono      --color-text-primary
 *   Info / banner  12px  --font-mono      var(--color-text-secondary)
 *   Uppercase hdr  11px  --font-mono      var(--color-text-label)
 *   Secondary      11px  --font-mono      var(--color-text-secondary)
 */

import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '12px',
  padding: '16px 14px',
  marginBottom: '14px',
};

export const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 400,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-label)',
  marginBottom: '10px',
};

export const fieldRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 0',
};

export const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'rgba(255,255,255,0.75)',
};

export const fieldValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'var(--color-text-primary)',
};

export const inputStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '16px', // Prevents iOS zoom
  width: '100%',
};

export const buttonStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  padding: '12px 16px',
  borderRadius: '8px',
  border: 'none',
  background: 'rgba(255,255,255,0.08)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
};

export const buttonDestructiveStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  padding: '12px 16px',
  borderRadius: '8px',
  border: 'none',
  background: 'rgba(224,92,92,0.15)',
  color: 'var(--color-destructive)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
};

export const footerStyle: CSSProperties = {
  padding: '16px 0',
};

export const statsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
  gap: '8px',
};

export const statCardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '10px',
  padding: '12px',
  border: '1px solid rgba(255,255,255,0.06)',
  textAlign: 'center',
};

export const statValueStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '18px',
  color: 'var(--color-text-primary)',
  marginBottom: '4px',
};

export const statLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 400,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-label)',
};
