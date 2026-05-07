import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinDisclosurePill } from '../BinDisclosurePill';

describe('BinDisclosurePill', () => {
  it('renders as a non-button span in nav mode', () => {
    const { container } = render(
      <BinDisclosurePill mode="nav" countLabel="12 items" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toContain('12 items');
  });

  it('renders as a button in expand mode and toggles aria-expanded', () => {
    render(
      <BinDisclosurePill
        mode="expand"
        countLabel="3 items"
        expanded={false}
        binName="Camping Gear"
        onToggle={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Show 3 items in Camping Gear');
  });

  it('reflects expanded=true in aria-expanded and label', () => {
    render(
      <BinDisclosurePill
        mode="expand"
        countLabel="1 item"
        expanded
        binName="Garage"
        onToggle={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Hide 1 item in Garage');
  });

  it('invokes onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(
      <BinDisclosurePill
        mode="expand"
        countLabel="3 items"
        expanded={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('passes aria-controls when controlsId is set', () => {
    render(
      <BinDisclosurePill
        mode="expand"
        countLabel="3 items"
        expanded={false}
        controlsId="items-abc"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button').getAttribute('aria-controls')).toBe('items-abc');
  });
});
