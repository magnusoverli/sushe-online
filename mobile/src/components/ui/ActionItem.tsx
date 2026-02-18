/**
 * ActionItem - Menu item for bottom sheets and action sheets.
 *
 * Spec (page 13):
 * - Icon container: 32x32px, radius 8px, rgba(255,255,255,0.05) bg
 * - Icon: stroke rgba(255,255,255,0.50), 16x16px
 * - Label: DM Mono 8.5px, rgba(255,255,255,0.75)
 * - Subtitle: DM Mono 7px, rgba(255,255,255,0.30), mt 1px
 * - Chevron: 12x12px SVG, rgba(255,255,255,0.20)
 * - Padding: 10px all, radius 10px
 * - Destructive variant: icon/label #E05C5C, bg rgba(224,92,92,0.10)
 */

import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface ActionItemProps {
  icon: ReactNode;
  label: string;
  subtitle?: string;
  destructive?: boolean;
  /** Alias for destructive - "destructive" variant sets destructive=true */
  variant?: 'standard' | 'destructive';
  showChevron?: boolean;
  /** Alias for showChevron */
  hasChevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 150ms ease',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const iconContainerBase: CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8.5px',
  fontWeight: 400,
  color: 'rgba(255,255,255,0.75)',
  flex: 1,
  minWidth: 0,
};

const subtitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '7px',
  fontWeight: 400,
  color: 'rgba(255,255,255,0.30)',
  marginTop: '1px',
};

export function ActionItem({
  icon,
  label,
  subtitle,
  destructive = false,
  variant,
  showChevron = false,
  hasChevron,
  onClick,
  disabled = false,
  style,
}: ActionItemProps) {
  const isDestructive = destructive || variant === 'destructive';
  const isChevron = showChevron || hasChevron;
  const iconColor = isDestructive
    ? 'var(--color-destructive)'
    : 'rgba(255,255,255,0.50)';
  const textColor = isDestructive
    ? 'var(--color-destructive)'
    : 'rgba(255,255,255,0.75)';
  const iconBg = isDestructive
    ? 'var(--color-destructive-bg)'
    : 'rgba(255,255,255,0.05)';

  return (
    <button
      type="button"
      style={{
        ...itemStyle,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      data-testid="action-item"
    >
      {/* Icon container */}
      <div
        style={{ ...iconContainerBase, background: iconBg, color: iconColor }}
      >
        {icon}
      </div>

      {/* Label + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...labelStyle, color: textColor }}>{label}</div>
        {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
      </div>

      {/* Chevron (not shown on destructive items) */}
      {isChevron && !isDestructive && (
        <ChevronRight
          size={12}
          style={{ color: 'rgba(255,255,255,0.20)', flexShrink: 0 }}
        />
      )}
    </button>
  );
}
