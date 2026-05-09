import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AiTurnQueryResult } from '../AiTurnQueryResult';

vi.mock('@/lib/usePermissions', () => ({
  usePermissions: () => ({ canWrite: false }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ activeLocationId: 'loc1' }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/features/items/itemActions', () => ({
  checkoutItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  removeItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  renameItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  updateQuantitySafe: vi.fn().mockResolvedValue({ ok: true, quantity: null }),
}));

describe('AiTurnQueryResult', () => {
  it('renders the answer within a flat-card', () => {
    const { container } = render(
      <MemoryRouter>
        <AiTurnQueryResult
          queryResult={{ answer: 'Found it', matches: [] }}
          onBinClick={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Found it')).toBeDefined();
    expect((container.firstChild as HTMLElement).className).toContain('flat-card');
  });

  it('does not render a follow-up textarea or Back button', () => {
    render(
      <MemoryRouter>
        <AiTurnQueryResult
          queryResult={{ answer: '', matches: [] }}
          onBinClick={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });

  it('renders mixed display modes independently — auto-expanded + collapsed do not interfere', () => {
    render(
      <MemoryRouter>
        <AiTurnQueryResult
          queryResult={{
            answer: 'Found these.',
            matches: [
              {
                bin_id: 'b1',
                name: 'Drill Bin',
                area_name: 'Garage',
                items: [{ id: 'i1', name: 'drill', quantity: null }],
                total_item_count: 12,
                tags: [],
                relevance: 'contains "drill"',
                icon: '',
                color: '#22c55e',
              },
              {
                bin_id: 'b2',
                name: 'Camping Gear',
                area_name: 'Garage',
                items: [
                  { id: 'i2', name: 'Tent', quantity: null },
                  { id: 'i3', name: 'Sleeping bag', quantity: null },
                ],
                total_item_count: 2,
                tags: [],
                relevance: 'name contains "camping"',
                icon: '',
                color: '#22c55e',
              },
            ],
          }}
          onBinClick={vi.fn()}
        />
      </MemoryRouter>,
    );
    // First bin: single-item match → auto-expanded.
    expect(
      screen.getByRole('button', { name: /hide 1 item in drill bin/i }).getAttribute('aria-expanded'),
    ).toBe('true');
    // Second bin: name match → collapsed.
    expect(
      screen.getByRole('button', { name: /show 2 items in camping gear/i }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
