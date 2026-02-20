import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkifiedText } from '../linkify';

describe('LinkifiedText', () => {
  it('renders plain text without links as a span', () => {
    render(<LinkifiedText text="Just plain text" />);
    expect(screen.getByText('Just plain text')).toBeInTheDocument();
    // No linkified-text wrapper when there are no URLs
    expect(screen.queryByTestId('linkified-text')).not.toBeInTheDocument();
  });

  it('renders null for empty string', () => {
    const { container } = render(<LinkifiedText text="" />);
    expect(container.innerHTML).toBe('');
  });

  it('converts a single URL to a clickable link', () => {
    render(<LinkifiedText text="Check https://example.com here" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('https://example.com');
  });

  it('handles text with embedded URL preserving surrounding text', () => {
    render(<LinkifiedText text="Go to https://example.com/path for info" />);
    expect(screen.getByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('for info')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveTextContent(
      'https://example.com/path'
    );
  });

  it('handles multiple URLs', () => {
    render(<LinkifiedText text="Visit https://a.com and http://b.com today" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://a.com');
    expect(links[1]).toHaveAttribute('href', 'http://b.com');
  });

  it('handles URL at the start of text', () => {
    render(<LinkifiedText text="https://start.com is here" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://start.com');
    expect(screen.getByText('is here')).toBeInTheDocument();
  });

  it('handles URL at the end of text', () => {
    render(<LinkifiedText text="Visit https://end.com" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://end.com');
    expect(screen.getByText('Visit')).toBeInTheDocument();
  });

  it('handles text that is just a URL', () => {
    render(<LinkifiedText text="https://only-url.com" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://only-url.com');
  });

  it('applies custom style prop', () => {
    render(
      <LinkifiedText
        text="Some https://example.com link"
        style={{ color: 'red' }}
      />
    );
    const wrapper = screen.getByTestId('linkified-text');
    expect(wrapper).toHaveStyle({ color: 'rgb(255, 0, 0)' });
  });
});
