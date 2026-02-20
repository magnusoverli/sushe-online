/**
 * CreateCollectionSheet - Bottom sheet for creating a new collection group.
 *
 * Simple form with a name input.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/Toast';
import { createGroup } from '@/services/groups';

interface CreateCollectionSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '8px',
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
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

export function CreateCollectionSheet({
  open,
  onClose,
  onCreated,
}: CreateCollectionSheetProps) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('Please enter a collection name', 'error');
      return;
    }
    if (/^\d{4}$/.test(trimmed)) {
      showToast('Collection name cannot be a 4-digit year', 'error');
      return;
    }
    setIsCreating(true);
    try {
      await createGroup(trimmed);
      showToast(`Created collection "${trimmed}"`, 'success');
      onClose();
      onCreated?.();
    } catch {
      showToast('Error creating collection', 'error');
    } finally {
      setIsCreating(false);
    }
  }, [name, onClose, onCreated]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Create Collection">
      <div
        style={{
          padding: '4px 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div>
          <label style={labelStyle}>Collection Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            maxLength={50}
            placeholder="Enter collection name"
            style={inputStyle}
            data-testid="create-collection-name"
          />
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
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
          data-testid="create-collection-submit"
        >
          {isCreating ? 'Creating...' : 'Create Collection'}
        </button>
      </div>
    </BottomSheet>
  );
}
