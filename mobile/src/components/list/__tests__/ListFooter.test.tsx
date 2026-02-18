import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListFooter } from '../ListFooter';

describe('ListFooter', () => {
  it('renders album count and end marker', () => {
    render(<ListFooter albumCount={25} />);
    const footer = screen.getByTestId('list-footer');
    expect(footer).toHaveTextContent('25 albums');
    expect(footer).toHaveTextContent('end of list');
  });

  it('uses singular for count of 1', () => {
    render(<ListFooter albumCount={1} />);
    const footer = screen.getByTestId('list-footer');
    expect(footer).toHaveTextContent('1 album');
    // Should NOT say "1 albums"
    expect(footer.textContent).not.toContain('1 albums');
  });
});
