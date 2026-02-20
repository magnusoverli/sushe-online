/**
 * GenreSelect - Searchable full-screen genre selector overlay.
 *
 * Features:
 * - Search input with filtering
 * - Three-tier sort: exact match > starts-with > contains
 * - "Other genres" section for non-matches
 * - Match text highlighting in green
 * - Selected genre indicated with checkmark
 * - Clear selection option
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, Check, ChevronDown } from 'lucide-react';
import { GENRES } from '@/lib/genres';
import { Scrim } from '@/components/ui/Scrim';

interface GenreSelectProps {
  value: string;
  onChange: (genre: string) => void;
  label: string;
  placeholder?: string;
}

/** Sort genres by relevance to search term. */
function sortGenres(
  genres: string[],
  search: string
): { matches: string[]; others: string[] } {
  if (!search) return { matches: genres, others: [] };

  const lower = search.toLowerCase();
  const exact: string[] = [];
  const startsWith: string[] = [];
  const contains: string[] = [];
  const others: string[] = [];

  for (const genre of genres) {
    const gl = genre.toLowerCase();
    if (gl === lower) {
      exact.push(genre);
    } else if (gl.startsWith(lower)) {
      startsWith.push(genre);
    } else if (gl.includes(lower)) {
      contains.push(genre);
    } else {
      others.push(genre);
    }
  }

  return {
    matches: [...exact, ...startsWith, ...contains],
    others,
  };
}

/** Highlight matching substring in genre text. */
function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) {
    return <>{text}</>;
  }

  const lower = text.toLowerCase();
  const idx = lower.indexOf(search.toLowerCase());

  if (idx === -1) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#4ade80', fontWeight: 500 }}>
        {text.slice(idx, idx + search.length)}
      </span>
      {text.slice(idx + search.length)}
    </>
  );
}

export function GenreSelect({
  value,
  onChange,
  label,
  placeholder = 'Select genre',
}: GenreSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when overlay opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure overlay is rendered
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const { matches, others } = useMemo(
    () => sortGenres(GENRES, search),
    [search]
  );

  const handleOpen = useCallback(() => {
    setSearch('');
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const handleSelect = useCallback(
    (genre: string) => {
      onChange(genre);
      setIsOpen(false);
      setSearch('');
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange('');
    setIsOpen(false);
    setSearch('');
  }, [onChange]);

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--color-divider)',
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)',
          fontSize: '16px',
          color: value
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)',
        }}
        data-testid={`genre-trigger-${label}`}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value || placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}
        />
      </button>

      {/* Full-screen overlay */}
      {isOpen && (
        <>
          <Scrim visible onDismiss={handleClose} zIndex={60} />
          <div
            style={{
              position: 'fixed',
              left: '16px',
              right: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 61,
              background: 'var(--color-surface)',
              borderRadius: '16px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            data-testid="genre-overlay"
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                borderBottom: '1px solid var(--color-divider)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '16px',
                  color: 'var(--color-text-primary)',
                }}
              >
                {label}
              </span>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: 'var(--color-text-secondary)',
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search input */}
            <div style={{ padding: '12px 16px' }}>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search genres..."
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--color-divider)',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '16px',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
                data-testid="genre-search"
              />
            </div>

            {/* Options list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
              }}
            >
              {/* Clear selection */}
              {value && (
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--color-divider)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    fontStyle: 'italic',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'left',
                  }}
                  data-testid="genre-clear"
                >
                  Clear selection
                </button>
              )}

              {/* Matches */}
              {matches.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => handleSelect(genre)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    background:
                      genre === value
                        ? 'rgba(255,255,255,0.05)'
                        : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--color-text-primary)',
                    textAlign: 'left',
                  }}
                  data-testid={`genre-option-${genre}`}
                >
                  <HighlightedText text={genre} search={search} />
                  {genre === value && (
                    <Check
                      size={14}
                      style={{ color: '#4ade80', flexShrink: 0 }}
                    />
                  )}
                </button>
              ))}

              {/* "Other genres" separator + non-matches */}
              {search && others.length > 0 && (
                <>
                  <div
                    style={{
                      padding: '8px 16px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-secondary)',
                      borderTop: '1px solid var(--color-divider)',
                      borderBottom: '1px solid var(--color-divider)',
                    }}
                  >
                    Other genres
                  </div>
                  {others.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => handleSelect(genre)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 16px',
                        background:
                          genre === value
                            ? 'rgba(255,255,255,0.05)'
                            : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'rgba(255,255,255,0.35)',
                        textAlign: 'left',
                      }}
                    >
                      {genre}
                      {genre === value && (
                        <Check
                          size={14}
                          style={{ color: '#4ade80', flexShrink: 0 }}
                        />
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
