/**
 * GroupAccordion - Collapsible group section in the navigation drawer.
 *
 * Renders a group header (with chevron, icon, name, ellipsis menu)
 * and a collapsible list of DrawerNavItem children.
 */

import { type ReactNode, useState, useCallback, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Calendar,
  Folder,
  MoreHorizontal,
} from 'lucide-react';

const STORAGE_KEY = 'sushe-mobile-accordion-state';

function readPersistedState(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistState(expanded: boolean, name: string): void {
  try {
    const ids = readPersistedState();
    if (expanded) {
      ids.add(name);
    } else {
      ids.delete(name);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable
  }
}

interface GroupAccordionProps {
  /** Group display name */
  name: string;
  /** Whether this is a year-based group */
  isYearGroup: boolean;
  /** Whether initially expanded */
  defaultExpanded?: boolean;
  /** Count of lists in this group */
  listCount?: number;
  /** Handler for the ellipsis/context menu button */
  onContextMenu?: () => void;
  /** Children (DrawerNavItem elements) */
  children: ReactNode;
  /** Visual state during group drag operations. */
  dragState?: 'default' | 'dragging' | 'drop-target';
  /** Show a drag handle on the group header. */
  showDragHandle?: boolean;
}

export function GroupAccordion({
  name,
  isYearGroup,
  defaultExpanded = false,
  onContextMenu,
  children,
  dragState = 'default',
  showDragHandle = false,
}: GroupAccordionProps) {
  const [expanded, setExpanded] = useState(() => {
    const persisted = readPersistedState();
    return persisted.has(name) || defaultExpanded;
  });

  // Persist changes to localStorage
  useEffect(() => {
    persistState(expanded, name);
  }, [expanded, name]);

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      onContextMenu?.();
    },
    [onContextMenu]
  );

  const Icon = isYearGroup ? Calendar : Folder;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  const isDragging = dragState === 'dragging';
  const isDropTarget = dragState === 'drop-target';

  return (
    <div data-testid="group-accordion">
      {/* Group header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 4px',
          opacity: isDragging ? 0.5 : 1,
          background: isDragging
            ? 'rgba(232,200,122,0.12)'
            : isDropTarget
              ? 'rgba(232,200,122,0.06)'
              : 'transparent',
          borderTop: isDropTarget
            ? '2px solid rgba(232,200,122,0.4)'
            : '2px solid transparent',
          borderRadius: '6px',
          transition:
            'background 150ms ease, opacity 150ms ease, border-color 150ms ease',
        }}
      >
        {showDragHandle && (
          <span
            style={{
              display: 'flex',
              flexShrink: 0,
              color: 'rgba(255,255,255,0.15)',
              touchAction: 'none',
            }}
            data-testid="group-drag-handle"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flex: 1,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 2px',
            borderRadius: '6px',
            minWidth: 0,
          }}
          aria-expanded={expanded}
          data-testid="group-accordion-toggle"
        >
          <Chevron
            size={12}
            style={{
              color: 'rgba(255,255,255,0.25)',
              flexShrink: 0,
            }}
          />
          <Icon
            size={12}
            strokeWidth={1.5}
            style={{
              color: 'rgba(255,255,255,0.30)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7.5px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.30)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'left',
            }}
            data-testid="group-accordion-name"
          >
            {name}
          </span>
        </button>

        {/* Context menu button (only for non-year groups that have a handler) */}
        {onContextMenu && (
          <button
            type="button"
            onClick={handleContextMenu}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              color: 'rgba(255,255,255,0.20)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-label={`Menu for ${name}`}
            data-testid="group-context-menu-btn"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {/* Collapsible content */}
      {expanded && (
        <div
          style={{ paddingLeft: '14px' }}
          data-testid="group-accordion-content"
        >
          {children}
        </div>
      )}
    </div>
  );
}
