/**
 * SetupWizardSheet - Bottom sheet wizard for completing list setup.
 *
 * Shows when lists need setup:
 * - Section 1: Lists missing a year — dropdown to assign a year
 * - Section 2: Years needing a main list — radio buttons to designate
 * - Save applies all pending updates via bulk-update API
 * - Skip dismisses the wizard for the current session
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/Toast';
import { bulkUpdateLists, dismissSetupWizard } from '@/services/lists';
import type {
  SetupStatus,
  SetupStatusList,
  SetupStatusYearSummary,
} from '@/lib/types';

interface SetupWizardSheetProps {
  open: boolean;
  onClose: () => void;
  setupStatus: SetupStatus;
  onSaved?: () => void;
  onSnoozed?: () => void;
}

const CURRENT_YEAR = new Date().getFullYear();

function generateYearOptions(): number[] {
  const years: number[] = [];
  for (let y = CURRENT_YEAR; y >= 2000; y--) {
    years.push(y);
  }
  return years;
}

const YEAR_OPTIONS = generateYearOptions();

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)',
  marginBottom: '8px',
  display: 'block',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '8px',
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'var(--color-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '6px',
  padding: '6px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '16px',
  color: 'var(--color-text-primary)',
  outline: 'none',
};

const yearLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '13px',
  color: 'var(--color-gold)',
  marginBottom: '4px',
};

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 10px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'var(--color-text-primary)',
};

const btnBaseStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  fontWeight: 500,
  padding: '12px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  width: '100%',
};

export function SetupWizardSheet({
  open,
  onClose,
  setupStatus,
  onSaved,
  onSnoozed,
}: SetupWizardSheetProps) {
  const listsWithoutYear = setupStatus.listsWithoutYear;
  const yearsNeedingMain = useMemo(
    () => setupStatus.yearsSummary.filter((y) => !y.hasMain),
    [setupStatus.yearsSummary]
  );

  // State: year assignments for lists without year
  const [yearAssignments, setYearAssignments] = useState<
    Record<string, number | null>
  >({});

  // State: main list selections per year
  const [mainSelections, setMainSelections] = useState<
    Record<number, string | null>
  >({});

  const [isSaving, setIsSaving] = useState(false);

  // Reset state when the sheet opens
  useEffect(() => {
    if (open) {
      setYearAssignments({});
      setMainSelections({});
      setIsSaving(false);
    }
  }, [open]);

  const handleYearChange = useCallback((listId: string, year: string) => {
    setYearAssignments((prev) => ({
      ...prev,
      [listId]: year ? parseInt(year, 10) : null,
    }));
  }, []);

  const handleMainChange = useCallback((year: number, listId: string) => {
    setMainSelections((prev) => ({
      ...prev,
      [year]: listId,
    }));
  }, []);

  // Determine if save is possible: all lists without year have a year, all years needing main have one
  const canSave = useMemo(() => {
    const allYearsAssigned = listsWithoutYear.every(
      (list) => yearAssignments[list.id] != null
    );
    const allMainsSet = yearsNeedingMain.every(
      (yearData) => mainSelections[yearData.year] != null
    );
    return allYearsAssigned && allMainsSet;
  }, [listsWithoutYear, yearsNeedingMain, yearAssignments, mainSelections]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const updates: { listId: string; year?: number; isMain?: boolean }[] = [];

    // Year assignments
    for (const list of listsWithoutYear) {
      const year = yearAssignments[list.id];
      if (year != null) {
        updates.push({ listId: list.id, year });
      }
    }

    // Main list selections
    for (const yearData of yearsNeedingMain) {
      const selectedListId = mainSelections[yearData.year];
      if (selectedListId) {
        updates.push({ listId: selectedListId, isMain: true });
      }
    }

    if (updates.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await bulkUpdateLists(updates);
      showToast('Lists updated', 'success');
      onClose();
      onSaved?.();
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    listsWithoutYear,
    yearsNeedingMain,
    yearAssignments,
    mainSelections,
    onClose,
    onSaved,
  ]);

  const handleSkip = useCallback(async () => {
    // Dismiss server-side, ignore errors
    try {
      await dismissSetupWizard();
    } catch {
      // Non-critical
    }
    onClose();
    onSnoozed?.();
  }, [onClose, onSnoozed]);

  const hasListsWithoutYear = listsWithoutYear.length > 0;
  const hasYearsNeedingMain = yearsNeedingMain.length > 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Complete List Setup"
      footer={
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isSaving}
            style={{
              ...btnBaseStyle,
              background: canSave
                ? 'var(--color-gold)'
                : 'rgba(255,255,255,0.08)',
              color: canSave ? '#1A1A1F' : 'rgba(255,255,255,0.3)',
              cursor: !canSave || isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.6 : 1,
            }}
            data-testid="setup-wizard-save"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={isSaving}
            style={{
              ...btnBaseStyle,
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            data-testid="setup-wizard-skip"
          >
            Skip for Now
          </button>
        </div>
      }
    >
      <div
        style={{
          padding: '4px 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Section 1: Lists without years */}
        {hasListsWithoutYear && (
          <div data-testid="section-lists-without-year">
            <span style={sectionTitleStyle}>
              Lists missing a year ({listsWithoutYear.length})
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {listsWithoutYear.map((list: SetupStatusList) => (
                <div key={list.id} style={rowStyle}>
                  <span style={nameStyle}>{list.name}</span>
                  <select
                    value={yearAssignments[list.id] ?? ''}
                    onChange={(e) => handleYearChange(list.id, e.target.value)}
                    style={selectStyle}
                    data-testid={`year-select-${list.id}`}
                  >
                    <option value="">Select year</option>
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2: Years needing main list */}
        {hasYearsNeedingMain && (
          <div data-testid="section-years-needing-main">
            <span style={sectionTitleStyle}>
              Choose main list for each year
            </span>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                marginBottom: '8px',
              }}
            >
              Your main list represents your definitive ranking for that year.
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {yearsNeedingMain.map((yearData: SetupStatusYearSummary) => (
                <div
                  key={yearData.year}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                  }}
                >
                  <div style={yearLabelStyle}>{yearData.year}</div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {yearData.lists.map((list) => (
                      <label key={list.id} style={radioLabelStyle}>
                        <input
                          type="radio"
                          name={`main-${yearData.year}`}
                          value={list.id}
                          checked={mainSelections[yearData.year] === list.id}
                          onChange={() =>
                            handleMainChange(yearData.year, list.id)
                          }
                          data-testid={`main-radio-${yearData.year}-${list.id}`}
                        />
                        {list.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
