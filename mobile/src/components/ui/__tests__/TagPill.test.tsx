import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TagPill } from '../TagPill';

describe('TagPill', () => {
  it('renders children text', () => {
    render(<TagPill>1977</TagPill>);
    expect(screen.getByText('1977')).toBeInTheDocument();
  });

  it('has correct test id', () => {
    render(<TagPill>ROCK</TagPill>);
    expect(screen.getByTestId('tag-pill')).toBeInTheDocument();
  });

  it('applies uppercase text transform', () => {
    render(<TagPill>rock</TagPill>);
    const pill = screen.getByTestId('tag-pill');
    expect(pill.style.textTransform).toBe('uppercase');
  });

  it('applies custom className', () => {
    render(<TagPill className="custom">tag</TagPill>);
    expect(screen.getByTestId('tag-pill')).toHaveClass('custom');
  });

  it('applies custom inline style', () => {
    render(<TagPill style={{ marginLeft: '4px' }}>tag</TagPill>);
    expect(screen.getByTestId('tag-pill').style.marginLeft).toBe('4px');
  });
});
