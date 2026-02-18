/**
 * Shared styles for settings tabs.
 * Consistent with the design system: DM Mono for body text, DM Serif Display for headers.
 */

import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = {
  marginBottom: '20px',
  paddingBottom: '16px',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};

export const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '7px',
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
  color: 'rgba(255,255,255,0.25)',
  marginBottom: '10px',
};

export const fieldRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
};

export const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8.5px',
  color: 'rgba(255,255,255,0.50)',
};

export const fieldValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8.5px',
  color: 'rgba(255,255,255,0.75)',
};

export const inputStyle: CSSProperties = {
  padding: '8px 12px',
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
  fontSize: '8.5px',
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: 'rgba(255,255,255,0.08)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
};

export const buttonDestructiveStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8.5px',
  padding: '8px 14px',
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
  fontSize: '7px',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  color: 'rgba(255,255,255,0.35)',
};
