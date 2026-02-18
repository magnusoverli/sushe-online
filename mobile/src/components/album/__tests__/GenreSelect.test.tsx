import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenreSelect } from '../GenreSelect';

describe('GenreSelect', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    label: 'Primary Genre',
    placeholder: 'Select genre',
  };

  it('renders trigger button with placeholder', () => {
    render(<GenreSelect {...defaultProps} />);
    expect(screen.getByText('Select genre')).toBeInTheDocument();
  });

  it('renders trigger button with selected value', () => {
    render(<GenreSelect {...defaultProps} value="Death Metal" />);
    expect(screen.getByText('Death Metal')).toBeInTheDocument();
  });

  it('opens overlay on click', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    expect(screen.getByTestId('genre-overlay')).toBeInTheDocument();
  });

  it('shows search input in overlay', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    expect(screen.getByTestId('genre-search')).toBeInTheDocument();
  });

  it('shows genre options', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    expect(screen.getByText('Death Metal')).toBeInTheDocument();
    expect(screen.getByText('Black Metal')).toBeInTheDocument();
  });

  it('filters genres on search', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    const searchInput = screen.getByTestId('genre-search');
    fireEvent.change(searchInput, { target: { value: 'doom' } });
    // Text is split by highlight spans, so use testid instead
    expect(screen.getByTestId('genre-option-Doom Metal')).toBeInTheDocument();
    expect(screen.getByTestId('genre-option-Doomgaze')).toBeInTheDocument();
  });

  it('calls onChange when a genre is selected', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    fireEvent.click(screen.getByTestId('genre-option-Doom Metal'));
    expect(defaultProps.onChange).toHaveBeenCalledWith('Doom Metal');
  });

  it('shows clear option when value is set', () => {
    render(<GenreSelect {...defaultProps} value="Death Metal" />);
    fireEvent.click(screen.getByText('Death Metal'));
    expect(screen.getByTestId('genre-clear')).toBeInTheDocument();
  });

  it('calls onChange with empty string on clear', () => {
    render(<GenreSelect {...defaultProps} value="Death Metal" />);
    fireEvent.click(screen.getByText('Death Metal'));
    fireEvent.click(screen.getByTestId('genre-clear'));
    expect(defaultProps.onChange).toHaveBeenCalledWith('');
  });

  it('shows "Other genres" section when searching', () => {
    render(<GenreSelect {...defaultProps} />);
    fireEvent.click(screen.getByText('Select genre'));
    const searchInput = screen.getByTestId('genre-search');
    fireEvent.change(searchInput, { target: { value: 'doom' } });
    expect(screen.getByText('Other genres')).toBeInTheDocument();
  });
});
