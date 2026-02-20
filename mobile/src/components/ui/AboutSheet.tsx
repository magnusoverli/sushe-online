/**
 * AboutSheet - Bottom sheet displaying app info and changelog.
 *
 * Mirrors the web app's about-modal. Reads changelog from the
 * static JSON data (imported at build time). Entries are grouped
 * by date with category badges, descriptions, and "show more".
 *
 * Categories: feature (green), fix (red), ui (blue), perf (purple), security (orange).
 */

import { useState, useCallback, type CSSProperties } from 'react';
import { BottomSheet } from './BottomSheet';
import changelogData from '../../../../src/data/changelog.json';

// ── Category metadata ──

const CATEGORY_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  feature: {
    label: 'feature',
    color: '#34d399',
    bg: 'rgba(52,211,153,0.12)',
  },
  fix: { label: 'fix', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  ui: { label: 'ui', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  perf: { label: 'perf', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  security: {
    label: 'security',
    color: '#fb923c',
    bg: 'rgba(251,146,60,0.12)',
  },
};

const INITIAL_COUNT = 15;

// ── Types ──

interface ChangelogEntry {
  date: string;
  category: string;
  description: string;
  hash?: string;
  commitMessage?: string;
}

interface AboutSheetProps {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ──

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

interface DateGroup {
  date: string;
  entries: ChangelogEntry[];
}

function groupByDate(entries: ChangelogEntry[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;

  for (const entry of entries) {
    if (!current || current.date !== entry.date) {
      current = { date: entry.date, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }

  return groups;
}

// ── Styles ──

const badgeStyle = (color: string, bg: string): CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color,
  background: bg,
  padding: '2px 6px',
  borderRadius: '4px',
  flexShrink: 0,
});

const entryRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  padding: '5px 0',
};

const descriptionStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  lineHeight: '1.5',
  color: 'rgba(255,255,255,0.75)',
  flex: 1,
  minWidth: 0,
};

const dateHeaderStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  color: 'rgba(255,255,255,0.35)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  textDecorationColor: 'rgba(255,255,255,0.10)',
  marginBottom: '4px',
  marginTop: '10px',
};

const showMoreStyle: CSSProperties = {
  width: '100%',
  padding: '10px',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--color-text-secondary)',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  cursor: 'pointer',
  marginTop: '8px',
};

// ── Component ──

export function AboutSheet({ open, onClose }: AboutSheetProps) {
  const [showAll, setShowAll] = useState(false);

  const entries: ChangelogEntry[] = Array.isArray(changelogData)
    ? (changelogData as ChangelogEntry[])
    : [];

  const visible = showAll ? entries : entries.slice(0, INITIAL_COUNT);
  const hasMore = entries.length > INITIAL_COUNT;
  const groups = groupByDate(visible);

  const handleShowMore = useCallback(() => {
    setShowAll(true);
  }, []);

  return (
    <BottomSheet open={open} onClose={onClose} title="About">
      <div style={{ padding: '0 8px 8px' }}>
        {/* App info */}
        <div
          style={{
            textAlign: 'center',
            padding: '8px 0 12px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            marginBottom: '4px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '17px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
            data-testid="about-app-name"
          >
            SuShe Online
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              marginTop: '4px',
            }}
          >
            Track and organize your music, one album at a time.
          </div>
        </div>

        {/* Changelog */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              color: 'var(--color-text-label)',
              marginTop: '12px',
              marginBottom: '4px',
            }}
          >
            What&apos;s New
          </div>

          {groups.length === 0 ? (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.35)',
                textAlign: 'center',
                padding: '20px 0',
              }}
            >
              No updates yet
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={gi}>
                <div style={dateHeaderStyle}>{formatDate(group.date)}</div>
                {group.entries.map((entry, ei) => {
                  const meta =
                    CATEGORY_META[entry.category] ?? CATEGORY_META.feature!;
                  return (
                    <div
                      key={ei}
                      style={entryRowStyle}
                      data-testid="changelog-entry"
                    >
                      <span style={badgeStyle(meta.color, meta.bg)}>
                        {meta.label}
                      </span>
                      <span style={descriptionStyle}>{entry.description}</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {/* Show more */}
          {hasMore && !showAll && (
            <button
              type="button"
              style={showMoreStyle}
              onClick={handleShowMore}
              data-testid="about-show-more"
            >
              Show more ({entries.length - INITIAL_COUNT} older entries)
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
