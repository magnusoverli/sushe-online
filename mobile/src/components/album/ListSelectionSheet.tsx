/**
 * ListSelectionSheet - Bottom sheet with year-accordion list picker.
 *
 * Used for Move to List and Copy to List operations.
 * Lists are grouped by year (descending), with an "Other" section
 * for lists without a year. First year group is expanded by default.
 */

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, Star, List as ListIcon } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import type { ListMetadata, Group } from '@/lib/types';

interface ListSelectionSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  albumName: string;
  artistName: string;
  currentListId: string | null;
  lists: Record<string, ListMetadata>;
  groups: Group[];
  onSelect: (listId: string) => void;
}

interface YearSection {
  label: string;
  year: number | null;
  lists: ListMetadata[];
}

function groupListsByYear(
  lists: Record<string, ListMetadata>,
  currentListId: string | null,
  groups: Group[]
): YearSection[] {
  // Build year map from groups and list metadata
  const yearMap = new Map<number | null, ListMetadata[]>();

  for (const list of Object.values(lists)) {
    // Exclude current list
    if (list._id === currentListId) continue;

    // Determine year from list or its group
    let year = list.year;
    if (year == null && list.groupId) {
      const group = groups.find((g) => g._id === list.groupId);
      if (group?.isYearGroup && group.year != null) {
        year = group.year;
      }
    }

    const existing = yearMap.get(year) ?? [];
    existing.push(list);
    yearMap.set(year, existing);
  }

  // Sort each year's lists by sortOrder
  for (const arr of yearMap.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Build sections: years descending, "Other" at the end
  const sections: YearSection[] = [];
  const years = [...yearMap.keys()]
    .filter((y): y is number => y != null)
    .sort((a, b) => b - a);

  for (const year of years) {
    sections.push({
      label: String(year),
      year,
      lists: yearMap.get(year) ?? [],
    });
  }

  const other = yearMap.get(null);
  if (other && other.length > 0) {
    sections.push({ label: 'Other', year: null, lists: other });
  }

  return sections;
}

export function ListSelectionSheet({
  open,
  onClose,
  title,
  albumName,
  artistName,
  currentListId,
  lists,
  groups,
  onSelect,
}: ListSelectionSheetProps) {
  const [expandedYear, setExpandedYear] = useState<string | null>(null);

  const sections = useMemo(
    () => groupListsByYear(lists, currentListId, groups),
    [lists, currentListId, groups]
  );

  // Auto-expand first section
  const effectiveExpanded = useMemo(() => {
    if (expandedYear !== null) return expandedYear;
    return sections[0]?.label ?? null;
  }, [expandedYear, sections]);

  const toggleSection = useCallback((label: string) => {
    setExpandedYear((prev) => (prev === label ? null : label));
  }, []);

  const handleSelect = useCallback(
    (listId: string) => {
      onClose();
      onSelect(listId);
    },
    [onClose, onSelect]
  );

  const noLists =
    sections.length === 0 || sections.every((s) => s.lists.length === 0);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={`${artistName} — ${albumName}`}
    >
      <div
        style={{
          padding: '0 4px 16px',
          maxHeight: '60vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {noLists ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
            }}
          >
            No other lists available.
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              {/* Section header */}
              <button
                type="button"
                onClick={() => toggleSection(section.label)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-divider)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {section.label}
                  <span
                    style={{
                      marginLeft: '8px',
                      color: 'var(--color-text-secondary)',
                      fontWeight: 400,
                    }}
                  >
                    ({section.lists.length})
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--color-text-secondary)',
                    transform:
                      effectiveExpanded === section.label
                        ? 'rotate(180deg)'
                        : 'none',
                    transition: 'transform 200ms ease',
                  }}
                />
              </button>

              {/* Section items */}
              <div
                style={{
                  maxHeight:
                    effectiveExpanded === section.label ? '500px' : '0',
                  overflow: 'hidden',
                  transition: 'max-height 200ms ease-out',
                }}
              >
                {section.lists.map((list) => (
                  <button
                    key={list._id}
                    type="button"
                    onClick={() => handleSelect(list._id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 16px 10px 28px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-divider)',
                    }}
                    data-testid={`list-option-${list._id}`}
                  >
                    {list.isMain ? (
                      <Star
                        size={12}
                        style={{ color: 'var(--color-gold)', flexShrink: 0 }}
                      />
                    ) : (
                      <ListIcon
                        size={12}
                        style={{
                          color: 'var(--color-text-secondary)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        color: 'var(--color-text-primary)',
                        flex: 1,
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {list.name}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: 'var(--color-text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      {list.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </BottomSheet>
  );
}
