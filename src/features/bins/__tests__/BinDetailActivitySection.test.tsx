import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityLogEntry } from '@/types';
import { BinDetailActivitySection } from '../BinDetailActivitySection';

vi.mock('../useBinActivity', () => ({
  useBinActivity: vi.fn(),
}));

vi.mock('@/lib/terminology', () => ({
  useTerminology: () => ({
    bin: 'bin', bins: 'bins', Bin: 'Bin', Bins: 'Bins',
    area: 'area', areas: 'areas', Area: 'Area', Areas: 'Areas',
    location: 'location', locations: 'locations', Location: 'Location', Locations: 'Locations',
  }),
}));

import { useBinActivity } from '../useBinActivity';

const mockUseBinActivity = vi.mocked(useBinActivity);

function entry(i: number): ActivityLogEntry {
  return {
    id: `e${i}`, location_id: 'loc-1', user_id: 'u1',
    user_name: 'user', display_name: `User${i}`,
    action: 'update', entity_type: 'bin', entity_id: 'bin-1',
    entity_name: 'Bin', changes: null,
    auth_method: 'jwt', api_key_name: null,
    created_at: `2026-04-${10 + i}T12:00:00Z`,
  };
}

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BinDetailActivitySection', () => {
  it('renders a loading skeleton when loading and no entries yet', () => {
    mockUseBinActivity.mockReturnValue({
      entries: [],
      isLoading: true, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getByRole('heading', { name: /activity/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
  });

  it('renders empty state when there are no entries', () => {
    mockUseBinActivity.mockReturnValue({
      entries: [],
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('renders error state when hook returns error', () => {
    mockUseBinActivity.mockReturnValue({
      entries: [],
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: 'Network failure', loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getByText(/failed to load activity/i)).toBeInTheDocument();
    expect(screen.getByText(/network failure/i)).toBeInTheDocument();
  });

  it('caps the preview at 5 entries and hides the Load More sentinel', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i));
    mockUseBinActivity.mockReturnValue({
      entries,
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getAllByText('User0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('User4').length).toBeGreaterThan(0);
    expect(screen.queryByText('User5')).toBeNull();
  });

  it('shows "Show all" when there are more than 5 entries and reveals remaining on click', async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 10 }, (_, i) => entry(i));
    mockUseBinActivity.mockReturnValue({
      entries,
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    const viewAll = screen.getByRole('button', { name: /show all/i });
    await user.click(viewAll);

    expect(screen.getAllByText('User5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('User9').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('"Show all" is shown when hasMore is true even if loaded entries <= 5', () => {
    const entries = Array.from({ length: 3 }, (_, i) => entry(i));
    mockUseBinActivity.mockReturnValue({
      entries,
      isLoading: false, isLoadingMore: false, hasMore: true,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument();
  });

  it('hides "Show all" when entries <= 5 and there is no more', () => {
    const entries = Array.from({ length: 3 }, (_, i) => entry(i));
    mockUseBinActivity.mockReturnValue({
      entries,
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /show less/i })).toBeNull();
  });

  it('collapses back to preview on "Show less" click', async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 10 }, (_, i) => entry(i));
    mockUseBinActivity.mockReturnValue({
      entries,
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    await user.click(screen.getByRole('button', { name: /show all/i }));
    await user.click(screen.getByRole('button', { name: /show less/i }));

    expect(screen.queryByText('User5')).toBeNull();
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument();
  });

  it('renders changed-field chips for merged update entries', () => {
    const e: ActivityLogEntry = {
      ...entry(0),
      action: 'update',
      changes: {
        notes: { old: 'A', new: 'B' },
        tags: { old: [], new: ['y'] },
      },
    };
    mockUseBinActivity.mockReturnValue({
      entries: [e],
      isLoading: false, isLoadingMore: false, hasMore: false,
      error: null, loadMore: vi.fn(),
    });

    renderWithRouter(<BinDetailActivitySection binId="bin-1" />);

    expect(screen.getByText('notes')).toBeInTheDocument();
    expect(screen.getByText('tags')).toBeInTheDocument();
  });
});
