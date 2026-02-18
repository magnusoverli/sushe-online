/**
 * ListActionSheet - Bottom sheet with actions for a list.
 *
 * Actions:
 * - Download (expandable: JSON / PDF / CSV)
 * - Edit Details
 * - Set as Main / Remove Main Status (only for year lists)
 * - Send to Service (Spotify/Tidal)
 * - Move to Collection (only for non-year lists)
 * - Delete List (destructive, with confirmation)
 */

import { useState, useCallback } from 'react';
import {
  Download,
  FileJson,
  FileText,
  FileSpreadsheet,
  Edit3,
  Star,
  Send,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import {
  downloadListAsJSON,
  downloadListAsCSV,
  downloadListAsPDF,
} from '@/services/downloads';
import { deleteList, setMainList } from '@/services/lists';
import type { ListMetadata, User } from '@/lib/types';

interface ListActionSheetProps {
  open: boolean;
  onClose: () => void;
  list: ListMetadata | null;
  user: User | null;
  /** Called after delete so parent can update state */
  onDeleted?: (listId: string) => void;
  /** Called after main toggle so parent can refresh */
  onMainToggled?: () => void;
  /** Open the edit details form */
  onEditDetails?: (listId: string) => void;
  /** Open collection picker */
  onMoveToCollection?: (listId: string) => void;
  /** Send list to connected music service */
  onSendToService?: (listId: string) => void;
  /** Whether the list is in a collection (not a year group) */
  isInCollection?: boolean;
}

export function ListActionSheet({
  open,
  onClose,
  list,
  user,
  onDeleted,
  onMainToggled,
  onEditDetails,
  onMoveToCollection,
  onSendToService,
  isInCollection = false,
}: ListActionSheetProps) {
  const [downloadExpanded, setDownloadExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const listId = list?._id;
  const hasYear = list?.year != null;

  // Determine music service label
  const getMusicServiceLabel = useCallback((): string | null => {
    if (!user) return null;
    const hasSpotify = user.spotifyConnected;
    const hasTidal = user.tidalConnected;
    if (hasSpotify && !hasTidal) return 'Send to Spotify';
    if (hasTidal && !hasSpotify) return 'Send to Tidal';
    if (hasSpotify && hasTidal) return 'Send to Spotify';
    return null;
  }, [user]);

  const musicServiceLabel = getMusicServiceLabel();

  // Download handlers
  const handleDownloadJSON = useCallback(async () => {
    if (!listId) return;
    onClose();
    try {
      showToast('Preparing export...', 'info', 2000);
      await downloadListAsJSON(listId);
      showToast('List exported as JSON', 'success');
    } catch {
      showToast('Error exporting list', 'error');
    }
  }, [listId, onClose]);

  const handleDownloadPDF = useCallback(async () => {
    if (!listId) return;
    onClose();
    try {
      showToast('Preparing PDF...', 'info', 2000);
      await downloadListAsPDF(listId);
      showToast('PDF exported', 'success');
    } catch {
      showToast('Error exporting PDF', 'error');
    }
  }, [listId, onClose]);

  const handleDownloadCSV = useCallback(async () => {
    if (!listId) return;
    onClose();
    try {
      showToast('Preparing CSV...', 'info', 2000);
      await downloadListAsCSV(listId);
      showToast('CSV exported', 'success');
    } catch {
      showToast('Error exporting CSV', 'error');
    }
  }, [listId, onClose]);

  const handleEditDetails = useCallback(() => {
    if (!listId) return;
    onClose();
    onEditDetails?.(listId);
  }, [listId, onClose, onEditDetails]);

  const handleToggleMain = useCallback(async () => {
    if (!listId || !list) return;
    onClose();
    try {
      await setMainList(listId, !list.isMain);
      showToast(
        list.isMain ? 'Removed main status' : 'Set as main list',
        'success'
      );
      onMainToggled?.();
    } catch {
      showToast('Error updating main status', 'error');
    }
  }, [listId, list, onClose, onMainToggled]);

  const handleSendToService = useCallback(() => {
    if (!listId) return;
    onClose();
    onSendToService?.(listId);
  }, [listId, onClose, onSendToService]);

  const handleMoveToCollection = useCallback(() => {
    if (!listId) return;
    onClose();
    onMoveToCollection?.(listId);
  }, [listId, onClose, onMoveToCollection]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!listId) return;
    setIsDeleting(true);
    try {
      await deleteList(listId);
      setConfirmDelete(false);
      showToast(`Deleted "${list?.name}"`, 'success');
      onDeleted?.(listId);
    } catch {
      showToast('Error deleting list', 'error');
    } finally {
      setIsDeleting(false);
    }
  }, [listId, list?.name, onDeleted]);

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={list?.name || 'List Actions'}
      >
        {/* Download (expandable) */}
        <ActionItem
          icon={<Download size={16} />}
          label="Download List..."
          showChevron={false}
          onClick={() => setDownloadExpanded((e) => !e)}
        />
        {/* Custom chevron indicator for expand state */}
        {downloadExpanded && (
          <div style={{ paddingLeft: '52px' }}>
            <ActionItem
              icon={<FileJson size={16} />}
              label="Download as JSON"
              onClick={handleDownloadJSON}
            />
            <ActionItem
              icon={<FileText size={16} />}
              label="Download as PDF"
              onClick={handleDownloadPDF}
            />
            <ActionItem
              icon={<FileSpreadsheet size={16} />}
              label="Download as CSV"
              onClick={handleDownloadCSV}
            />
          </div>
        )}

        {/* Divider */}
        <div
          style={{
            height: '1px',
            background: 'var(--color-divider)',
            margin: '4px 10px',
          }}
        />

        {/* Edit Details */}
        <ActionItem
          icon={<Edit3 size={16} />}
          label="Edit Details"
          onClick={handleEditDetails}
        />

        {/* Toggle Main (only for year lists) */}
        {hasYear && (
          <ActionItem
            icon={<Star size={16} />}
            label={list?.isMain ? 'Remove Main Status' : 'Set as Main'}
            onClick={handleToggleMain}
          />
        )}

        {/* Send to Service */}
        {musicServiceLabel && (
          <ActionItem
            icon={<Send size={16} />}
            label={musicServiceLabel}
            onClick={handleSendToService}
          />
        )}

        {/* Move to Collection (only for non-year lists) */}
        {isInCollection && (
          <ActionItem
            icon={<FolderOpen size={16} />}
            label="Move to Collection"
            showChevron
            onClick={handleMoveToCollection}
          />
        )}

        {/* Divider */}
        <div
          style={{
            height: '1px',
            background: 'var(--color-divider)',
            margin: '4px 10px',
          }}
        />

        {/* Delete */}
        <ActionItem
          icon={<Trash2 size={16} />}
          label="Delete List"
          destructive
          onClick={() => {
            onClose();
            setConfirmDelete(true);
          }}
        />
      </BottomSheet>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(false)}
        title="Delete List"
        message={`Are you sure you want to delete the list "${list?.name}"?`}
        warning="This action cannot be undone."
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        confirmDisabled={isDeleting}
        destructive
      />
    </>
  );
}
