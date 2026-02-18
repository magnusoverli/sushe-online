/**
 * VisualTab - Accent color, time format, date format.
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';
import {
  useUpdateAccentColor,
  useUpdateTimeFormat,
  useUpdateDateFormat,
} from '@/hooks/useSettings';
import {
  sectionStyle,
  sectionTitleStyle,
  fieldRowStyle,
  fieldLabelStyle,
} from './shared-styles';

export function VisualTab() {
  const user = useAppStore((s) => s.user);
  const [colorValue, setColorValue] = useState(user?.accentColor ?? '#dc2626');

  const accentMutation = useUpdateAccentColor();
  const timeMutation = useUpdateTimeFormat();
  const dateMutation = useUpdateDateFormat();

  const handleColorChange = useCallback(
    (hex: string) => {
      setColorValue(hex);
      accentMutation.mutate(hex);
    },
    [accentMutation]
  );

  if (!user) return null;

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Accent color */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Accent Color</div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '7.5px',
            color: 'rgba(255,255,255,0.35)',
            marginBottom: '8px',
          }}
        >
          Customizes the accent color across the application
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="color"
            value={colorValue}
            onChange={(e) => handleColorChange(e.target.value)}
            style={{
              width: '40px',
              height: '40px',
              padding: 0,
              border: '2px solid rgba(255,255,255,0.10)',
              borderRadius: '8px',
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
            }}
          >
            {colorValue}
          </span>
        </div>
      </div>

      {/* Time format */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Time Format</div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Format</span>
          <select
            value={user.timeFormat ?? '24h'}
            onChange={(e) => timeMutation.mutate(e.target.value)}
            disabled={timeMutation.isPending}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '16px',
              appearance: 'auto' as never,
            }}
          >
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </select>
        </div>
      </div>

      {/* Date format */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Date Format</div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Format</span>
          <select
            value={user.dateFormat ?? 'MM/DD/YYYY'}
            onChange={(e) => dateMutation.mutate(e.target.value)}
            disabled={dateMutation.isPending}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '16px',
              appearance: 'auto' as never,
            }}
          >
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          </select>
        </div>
      </div>
    </div>
  );
}
