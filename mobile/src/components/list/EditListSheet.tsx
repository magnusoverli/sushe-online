/**
 * EditListSheet - Bottom sheet for editing list details (name + year).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/Toast';
import { updateList } from '@/services/lists';
import type { ListMetadata } from '@/lib/types';

interface EditListSheetProps {
  open: boolean;
  onClose: () => void;
  list: ListMetadata | null;
  onUpdated?: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '8px',
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '16px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)',
  marginBottom: '4px',
  display: 'block',
};

export function EditListSheet({
  open,
  onClose,
  list,
  onUpdated,
}: EditListSheetProps) {
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && list) {
      setName(list.name);
      setYear(list.year != null ? String(list.year) : '');
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open, list]);

  const handleSave = useCallback(async () => {
    if (!list) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('Name cannot be empty', 'error');
      return;
    }

    const updates: { name?: string; year?: number } = {};
    if (trimmedName !== list.name) updates.name = trimmedName;

    const yearNum = year ? parseInt(year, 10) : undefined;
    if (yearNum !== undefined) {
      if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
        showToast('Year must be between 1000 and 9999', 'error');
        return;
      }
    }
    if ((yearNum ?? null) !== (list.year ?? null)) {
      updates.year = yearNum;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await updateList(list._id, updates);
      showToast('List updated', 'success');
      onClose();
      onUpdated?.();
    } catch {
      showToast('Error updating list', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [list, name, year, onClose, onUpdated]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Edit Details">
      <div
        style={{
          padding: '4px 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div>
          <label style={labelStyle}>List Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            maxLength={50}
            style={inputStyle}
            data-testid="edit-list-name"
          />
        </div>

        <div>
          <label style={labelStyle}>Year (optional)</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min={1000}
            max={9999}
            placeholder="e.g. 2025"
            style={inputStyle}
            data-testid="edit-list-year"
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            fontWeight: 500,
            padding: '12px',
            borderRadius: '10px',
            border: 'none',
            background: 'var(--color-gold)',
            color: '#1A1A1F',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.6 : 1,
            width: '100%',
          }}
          data-testid="edit-list-submit"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </BottomSheet>
  );
}
