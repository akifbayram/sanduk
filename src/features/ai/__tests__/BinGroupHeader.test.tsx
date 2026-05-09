import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinGroupHeader } from '../BinGroupHeader';

describe('BinGroupHeader', () => {
  it('renders bin name and area', () => {
    render(
      <BinGroupHeader
        name="Camping Gear"
        areaName="Garage"
        icon=""
        color="#22c55e"
        isTrashed={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Camping Gear')).toBeDefined();
    expect(screen.getByText('Garage')).toBeDefined();
  });

  it('invokes onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(
      <BinGroupHeader name="X" areaName="" icon="" color="#000" isTrashed={false} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('applies trashed styling when isTrashed', () => {
    const { container } = render(
      <BinGroupHeader name="X" areaName="" icon="" color="#000" isTrashed onOpen={vi.fn()} />,
    );
    expect(container.querySelector('[data-trashed="true"]')).toBeTruthy();
  });

  it('applies trashed styling on the wrapper when isTrashed and interactive', () => {
    const { container } = render(
      <BinGroupHeader
        name="X"
        areaName=""
        icon=""
        color="#000"
        isTrashed
        onOpen={vi.fn()}
        interactive
        trailing={
          <button type="button" aria-label="toggle items">
            tog
          </button>
        }
      />,
    );
    expect(container.querySelector('[data-trashed="true"]')).toBeTruthy();
  });

  it('renders trailing element when provided (single-button mode)', () => {
    render(
      <BinGroupHeader
        name="X"
        areaName=""
        icon=""
        color="#000"
        isTrashed={false}
        onOpen={vi.fn()}
        trailing={<span data-testid="trailing">trailing-content</span>}
      />,
    );
    expect(screen.getByTestId('trailing').textContent).toBe('trailing-content');
    // Single-button mode: only one button, the bin opener.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders split layout with two siblings when interactive is true', () => {
    render(
      <BinGroupHeader
        name="X"
        areaName=""
        icon=""
        color="#000"
        isTrashed={false}
        onOpen={vi.fn()}
        interactive
        trailing={
          <button type="button" aria-label="toggle items">
            tog
          </button>
        }
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole('button', { name: /open/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /toggle items/i })).toBeDefined();
  });

  it('clicking the open button does not invoke handler on the trailing button (interactive)', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <BinGroupHeader
        name="X"
        areaName=""
        icon=""
        color="#000"
        isTrashed={false}
        onOpen={onOpen}
        interactive
        trailing={
          <button type="button" aria-label="toggle items" onClick={onToggle}>
            tog
          </button>
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
