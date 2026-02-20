import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetupWizardSheet } from '../SetupWizardSheet';
import type { SetupStatus } from '@/lib/types';

vi.mock('@/services/lists', () => ({
  bulkUpdateLists: vi.fn(() =>
    Promise.resolve({ success: true, results: [], recomputingYears: [] })
  ),
  dismissSetupWizard: vi.fn(() =>
    Promise.resolve({ success: true, dismissedUntil: '2026-02-19T00:00:00Z' })
  ),
}));

async function getBulkUpdateLists() {
  const mod = await import('@/services/lists');
  return mod.bulkUpdateLists as ReturnType<typeof vi.fn>;
}

async function getDismissSetupWizard() {
  const mod = await import('@/services/lists');
  return mod.dismissSetupWizard as ReturnType<typeof vi.fn>;
}

const baseStatus: SetupStatus = {
  needsSetup: true,
  listsWithoutYear: [],
  yearsNeedingMain: [],
  yearsSummary: [],
  dismissedUntil: null,
};

describe('SetupWizardSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the lists-without-year section when present', () => {
    const status: SetupStatus = {
      ...baseStatus,
      listsWithoutYear: [
        { id: 'list-1', name: 'My Draft' },
        { id: 'list-2', name: 'Another' },
      ],
    };

    render(<SetupWizardSheet open onClose={vi.fn()} setupStatus={status} />);

    expect(
      screen.getByTestId('section-lists-without-year')
    ).toBeInTheDocument();
    expect(screen.getByText('My Draft')).toBeInTheDocument();
    expect(screen.getByText('Another')).toBeInTheDocument();
    expect(screen.getByTestId('year-select-list-1')).toBeInTheDocument();
    expect(screen.getByTestId('year-select-list-2')).toBeInTheDocument();
  });

  it('renders the years-needing-main section when present', () => {
    const status: SetupStatus = {
      ...baseStatus,
      yearsSummary: [
        {
          year: 2025,
          hasMain: false,
          lists: [
            { id: 'l1', name: 'Best of 2025', isMain: false },
            { id: 'l2', name: 'Runners Up', isMain: false },
          ],
        },
      ],
    };

    render(<SetupWizardSheet open onClose={vi.fn()} setupStatus={status} />);

    expect(
      screen.getByTestId('section-years-needing-main')
    ).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('Best of 2025')).toBeInTheDocument();
    expect(screen.getByText('Runners Up')).toBeInTheDocument();
  });

  it('does not render hidden sections', () => {
    const status: SetupStatus = {
      ...baseStatus,
      listsWithoutYear: [{ id: 'list-1', name: 'Draft' }],
      yearsSummary: [
        {
          year: 2024,
          hasMain: true,
          lists: [{ id: 'x', name: 'X', isMain: true }],
        },
      ],
    };

    render(<SetupWizardSheet open onClose={vi.fn()} setupStatus={status} />);

    expect(
      screen.getByTestId('section-lists-without-year')
    ).toBeInTheDocument();
    // Years-needing-main should NOT appear since all years have a main
    expect(
      screen.queryByTestId('section-years-needing-main')
    ).not.toBeInTheDocument();
  });

  it('save button is disabled until all fields are filled', () => {
    const status: SetupStatus = {
      ...baseStatus,
      listsWithoutYear: [{ id: 'list-1', name: 'Draft' }],
      yearsSummary: [
        {
          year: 2025,
          hasMain: false,
          lists: [{ id: 'l1', name: 'List A', isMain: false }],
        },
      ],
    };

    render(<SetupWizardSheet open onClose={vi.fn()} setupStatus={status} />);

    const saveBtn = screen.getByTestId('setup-wizard-save');
    expect(saveBtn).toBeDisabled();
  });

  it('enables save and triggers API when all fields filled', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const status: SetupStatus = {
      ...baseStatus,
      listsWithoutYear: [{ id: 'list-1', name: 'Draft' }],
      yearsSummary: [
        {
          year: 2025,
          hasMain: false,
          lists: [
            { id: 'l1', name: 'List A', isMain: false },
            { id: 'l2', name: 'List B', isMain: false },
          ],
        },
      ],
    };

    render(
      <SetupWizardSheet
        open
        onClose={onClose}
        setupStatus={status}
        onSaved={onSaved}
      />
    );

    // Assign year to list-1
    fireEvent.change(screen.getByTestId('year-select-list-1'), {
      target: { value: '2024' },
    });

    // Select main list for 2025
    fireEvent.click(screen.getByTestId('main-radio-2025-l1'));

    const saveBtn = screen.getByTestId('setup-wizard-save');
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    const bulkUpdateLists = await getBulkUpdateLists();
    await waitFor(() => {
      expect(bulkUpdateLists).toHaveBeenCalledTimes(1);
    });

    // Check the payload
    const callArgs = bulkUpdateLists.mock.calls[0]![0] as Array<{
      listId: string;
      year?: number;
      isMain?: boolean;
    }>;
    expect(callArgs).toEqual(
      expect.arrayContaining([
        { listId: 'list-1', year: 2024 },
        { listId: 'l1', isMain: true },
      ])
    );

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('skip button dismisses wizard and calls onSnoozed', async () => {
    const onSnoozed = vi.fn();
    const onClose = vi.fn();

    render(
      <SetupWizardSheet
        open
        onClose={onClose}
        setupStatus={baseStatus}
        onSnoozed={onSnoozed}
      />
    );

    fireEvent.click(screen.getByTestId('setup-wizard-skip'));

    const dismissSetupWizard = await getDismissSetupWizard();
    await waitFor(() => {
      expect(dismissSetupWizard).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onSnoozed).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render sections when nothing needs setup', () => {
    const status: SetupStatus = {
      ...baseStatus,
      needsSetup: false,
      yearsSummary: [
        {
          year: 2025,
          hasMain: true,
          lists: [{ id: 'x', name: 'X', isMain: true }],
        },
      ],
    };

    render(<SetupWizardSheet open onClose={vi.fn()} setupStatus={status} />);

    expect(
      screen.queryByTestId('section-lists-without-year')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('section-years-needing-main')
    ).not.toBeInTheDocument();
  });
});
