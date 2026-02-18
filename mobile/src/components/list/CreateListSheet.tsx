/**
 * CreateListSheet - Bottom sheet for creating a new list.
 *
 * Fields:
 * - List Name (required, maxlength 50)
 * - Category (select: year groups, collections, + new year, + new collection)
 * - New Year (number input, shown when "+ New year..." selected)
 * - New Collection (text input, shown when "+ New collection..." selected)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/Toast';
import { createList } from '@/services/lists';
import { createGroup } from '@/services/groups';
import type { Group } from '@/lib/types';

interface CreateListSheetProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  onCreated?: (listId: string) => void;
}

const CATEGORY_NEW_YEAR = '__new_year__';
const CATEGORY_NEW_COLLECTION = '__new_collection__';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '8px',
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8px',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)',
  marginBottom: '4px',
  display: 'block',
};

export function CreateListSheet({
  open,
  onClose,
  groups,
  onCreated,
}: CreateListSheetProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const yearGroups = groups
    .filter((g) => g.isYearGroup)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const collections = groups.filter((g) => !g.isYearGroup);

  // Focus name input on open
  useEffect(() => {
    if (open) {
      setName('');
      setCategory('');
      setNewYear('');
      setNewCollection('');
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('Please enter a list name', 'error');
      return;
    }
    if (!category) {
      showToast('Please select a category', 'error');
      return;
    }

    setIsCreating(true);
    try {
      let groupId: string | undefined;
      let year: number | undefined;

      if (category === CATEGORY_NEW_YEAR) {
        const yearNum = parseInt(newYear, 10);
        if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
          showToast('Year must be between 1000 and 9999', 'error');
          setIsCreating(false);
          return;
        }
        year = yearNum;
        // Year group is auto-created by the backend
      } else if (category === CATEGORY_NEW_COLLECTION) {
        const collName = newCollection.trim();
        if (!collName) {
          showToast('Please enter a collection name', 'error');
          setIsCreating(false);
          return;
        }
        if (/^\d{4}$/.test(collName)) {
          showToast('Collection name cannot be a 4-digit year', 'error');
          setIsCreating(false);
          return;
        }
        const newGroup = await createGroup(collName);
        groupId = newGroup._id;
      } else {
        // Existing group selected
        const selectedGroup = groups.find((g) => g._id === category);
        if (selectedGroup) {
          groupId = selectedGroup._id;
          if (selectedGroup.isYearGroup && selectedGroup.year) {
            year = selectedGroup.year;
          }
        }
      }

      const result = await createList({
        name: trimmedName,
        groupId,
        year,
        data: [],
      });

      showToast(`Created "${trimmedName}"`, 'success');
      onClose();
      onCreated?.(result._id);
    } catch {
      showToast('Error creating list', 'error');
    } finally {
      setIsCreating(false);
    }
  }, [name, category, newYear, newCollection, groups, onClose, onCreated]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Create List">
      <div
        style={{
          padding: '4px 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* List Name */}
        <div>
          <label style={labelStyle}>List Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            maxLength={50}
            placeholder="Enter list name"
            style={inputStyle}
            data-testid="create-list-name"
          />
        </div>

        {/* Category */}
        <div>
          <label style={labelStyle}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              ...inputStyle,
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: '32px',
            }}
            data-testid="create-list-category"
          >
            <option value="" disabled>
              Select category...
            </option>
            {yearGroups.length > 0 && (
              <optgroup label="Years">
                {yearGroups.map((g) => (
                  <option key={g._id} value={g._id}>
                    {g.name}
                  </option>
                ))}
                <option value={CATEGORY_NEW_YEAR}>+ New year...</option>
              </optgroup>
            )}
            {yearGroups.length === 0 && (
              <option value={CATEGORY_NEW_YEAR}>+ New year...</option>
            )}
            <optgroup label="Collections">
              {collections.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
              <option value={CATEGORY_NEW_COLLECTION}>
                + New collection...
              </option>
            </optgroup>
          </select>
        </div>

        {/* New Year input */}
        {category === CATEGORY_NEW_YEAR && (
          <div>
            <label style={labelStyle}>Year</label>
            <input
              type="number"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              min={1000}
              max={9999}
              placeholder="e.g. 2025"
              style={inputStyle}
              data-testid="create-list-new-year"
            />
          </div>
        )}

        {/* New Collection input */}
        {category === CATEGORY_NEW_COLLECTION && (
          <div>
            <label style={labelStyle}>Collection Name</label>
            <input
              type="text"
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              maxLength={50}
              placeholder="Enter collection name"
              style={inputStyle}
              data-testid="create-list-new-collection"
            />
          </div>
        )}

        {/* Create button */}
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 500,
            padding: '12px',
            borderRadius: '10px',
            border: 'none',
            background: 'var(--color-gold)',
            color: '#1A1A1F',
            cursor: isCreating ? 'not-allowed' : 'pointer',
            opacity: isCreating ? 0.6 : 1,
            width: '100%',
          }}
          data-testid="create-list-submit"
        >
          {isCreating ? 'Creating...' : 'Create List'}
        </button>
      </div>
    </BottomSheet>
  );
}
