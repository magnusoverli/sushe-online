/**
 * GroupAccordion - Collapsible group section in the navigation drawer.
 *
 * Renders a group header (with chevron, icon, name, ellipsis menu)
 * and a collapsible list of DrawerNavItem children.
 */

import { type ReactNode, useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Calendar,
  Folder,
  MoreHorizontal,
} from 'lucide-react';

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
}

export function GroupAccordion({
  name,
  isYearGroup,
  defaultExpanded = false,
  onContextMenu,
  children,
}: GroupAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

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

  return (
    <div data-testid="group-accordion">
      {/* Group header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 4px',
        }}
      >
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
