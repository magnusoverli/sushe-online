/**
 * VisualTab - Accent color, time format, date format, interface toggle.
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';
import {
  useUpdateAccentColor,
  useUpdateTimeFormat,
  useUpdateDateFormat,
  useUpdatePreferredUi,
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
  const [switchingUi, setSwitchingUi] = useState(false);

  const accentMutation = useUpdateAccentColor();
  const timeMutation = useUpdateTimeFormat();
  const dateMutation = useUpdateDateFormat();
  const preferredUiMutation = useUpdatePreferredUi();

  const handleColorChange = useCallback(
    (hex: string) => {
      setColorValue(hex);
      accentMutation.mutate(hex);
    },
    [accentMutation]
  );

  const handleSwitchToLegacy = useCallback(() => {
    setSwitchingUi(true);
    preferredUiMutation.mutate('desktop', {
      onSuccess: () => {
        // Navigate to the legacy UI (full page redirect)
        window.location.href = '/';
      },
      onError: () => {
        setSwitchingUi(false);
      },
    });
  }, [preferredUiMutation]);

  if (!user) return null;

  return (
    <div style={{ padding: '16px 12px' }}>
      {/* Accent color */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Accent Color</div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
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
              fontSize: '11px',
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
              padding: '10px 12px',
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
              padding: '10px 12px',
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

      {/* Interface toggle */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Interface</div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            marginBottom: '12px',
            lineHeight: 1.5,
          }}
        >
          You&apos;re using the new mobile interface. Switch back to the classic
          view if you prefer.
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>New mobile interface</span>
          <button
            type="button"
            onClick={handleSwitchToLegacy}
            disabled={switchingUi}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(255,255,255,0.08)',
              color: 'var(--color-text-primary)',
              cursor: switchingUi ? 'default' : 'pointer',
              opacity: switchingUi ? 0.5 : 1,
            }}
          >
            {switchingUi ? 'Switching...' : 'Switch to classic'}
          </button>
        </div>
      </div>
    </div>
  );
}
