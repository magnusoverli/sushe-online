import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionItem } from '../ActionItem';

const MockIcon = () => <span data-testid="mock-icon">icon</span>;

describe('ActionItem', () => {
  it('renders label and icon', () => {
    render(<ActionItem icon={<MockIcon />} label="Edit Album" />);
    expect(screen.getByText('Edit Album')).toBeInTheDocument();
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(
      <ActionItem
        icon={<MockIcon />}
        label="Sort List"
        subtitle="Currently by Year"
      />
    );
    expect(screen.getByText('Currently by Year')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    render(<ActionItem icon={<MockIcon />} label="Edit" />);
    expect(screen.queryByText('Currently')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ActionItem icon={<MockIcon />} label="Edit" onClick={onClick} />);
    fireEvent.click(screen.getByTestId('action-item'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <ActionItem icon={<MockIcon />} label="Edit" onClick={onClick} disabled />
    );
    fireEvent.click(screen.getByTestId('action-item'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows chevron when showChevron is true and not destructive', () => {
    const { container } = render(
      <ActionItem icon={<MockIcon />} label="More" showChevron />
    );
    // Lucide ChevronRight renders an SVG
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('hides chevron on destructive items even with showChevron', () => {
    render(
      <ActionItem icon={<MockIcon />} label="Delete" destructive showChevron />
    );
    // Destructive items should not show the chevron
    // The only SVG should be the MockIcon (via data-testid)
    expect(
      screen.getByTestId('action-item').querySelectorAll('svg')
    ).toHaveLength(0);
  });
});
