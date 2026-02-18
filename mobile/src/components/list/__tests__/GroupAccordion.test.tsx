import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupAccordion } from '../GroupAccordion';

describe('GroupAccordion', () => {
  it('renders group name', () => {
    render(
      <GroupAccordion name="2024" isYearGroup>
        <div>child</div>
      </GroupAccordion>
    );
    expect(screen.getByTestId('group-accordion-name')).toHaveTextContent(
      '2024'
    );
  });

  it('is collapsed by default', () => {
    render(
      <GroupAccordion name="Collection" isYearGroup={false}>
        <div data-testid="child-content">item</div>
      </GroupAccordion>
    );
    expect(
      screen.queryByTestId('group-accordion-content')
    ).not.toBeInTheDocument();
  });

  it('expands when defaultExpanded is true', () => {
    render(
      <GroupAccordion name="2024" isYearGroup defaultExpanded>
        <div data-testid="child-content">item</div>
      </GroupAccordion>
    );
    expect(screen.getByTestId('group-accordion-content')).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('toggles expand/collapse on click', () => {
    render(
      <GroupAccordion name="2024" isYearGroup>
        <div data-testid="child-content">item</div>
      </GroupAccordion>
    );
    expect(
      screen.queryByTestId('group-accordion-content')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('group-accordion-toggle'));
    expect(screen.getByTestId('group-accordion-content')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('group-accordion-toggle'));
    expect(
      screen.queryByTestId('group-accordion-content')
    ).not.toBeInTheDocument();
  });

  it('shows context menu button when handler provided', () => {
    const onContextMenu = vi.fn();
    render(
      <GroupAccordion
        name="Favorites"
        isYearGroup={false}
        onContextMenu={onContextMenu}
      >
        <div>item</div>
      </GroupAccordion>
    );
    const btn = screen.getByTestId('group-context-menu-btn');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not show context menu button when no handler', () => {
    render(
      <GroupAccordion name="2024" isYearGroup>
        <div>item</div>
      </GroupAccordion>
    );
    expect(
      screen.queryByTestId('group-context-menu-btn')
    ).not.toBeInTheDocument();
  });

  it('sets aria-expanded correctly', () => {
    render(
      <GroupAccordion name="2024" isYearGroup>
        <div>item</div>
      </GroupAccordion>
    );
    const toggle = screen.getByTestId('group-accordion-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
