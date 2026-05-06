import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();
const mockAsk = vi.fn();
const mockExecuteBatch = vi.fn();
const mockShowToast = vi.fn();
const mockCancelAsk = vi.fn();
const mockClearAsk = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return { apiFetch: vi.fn(), ApiError };
});

vi.mock('@/lib/apiStream', () => ({
  apiStream: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ activeLocationId: 'loc-1', token: 'tok', user: { id: 'u1' } }),
}));

vi.mock('@/lib/usePermissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}));

vi.mock('@/features/items/itemActions', () => ({
  checkoutItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  removeItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  renameItemSafe: vi.fn().mockResolvedValue({ ok: true }),
  updateQuantitySafe: vi.fn().mockResolvedValue({ ok: true, quantity: null }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../useAiSettings', () => ({
  useAiSettings: () => ({
    settings: { id: 's1', provider: 'openai', apiKey: 'k', model: 'gpt-4o', endpointUrl: null },
    isLoading: false,
  }),
}));

vi.mock('@/features/areas/useAreas', () => ({
  useAreaList: () => ({ areas: [], isLoading: false }),
  createArea: vi.fn(),
}));

vi.mock('@/lib/terminology', () => ({
  useTerminology: () => ({
    bin: 'bin', bins: 'bins', Bin: 'Bin', Bins: 'Bins',
    location: 'location', locations: 'locations', Location: 'Location', Locations: 'Locations',
    area: 'area', areas: 'areas', Area: 'Area', Areas: 'Areas',
  }),
}));

vi.mock('@/features/bins/useBins', () => ({
  addBin: vi.fn(),
  updateBin: vi.fn(),
  deleteBin: vi.fn(),
  restoreBin: vi.fn(),
  notifyBinsChanged: vi.fn(),
  addItemsToBin: vi.fn(),
  useBinList: () => ({ bins: [], isLoading: false, refresh: vi.fn() }),
}));

vi.mock('@/lib/audioRecorder', () => ({
  isRecordingSupported: () => false,
  startRecording: vi.fn(),
}));

vi.mock('@/lib/useTranscription', () => ({
  useTranscription: () => ({
    state: 'idle',
    duration: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { ai_asked_at: null },
    isLoading: false,
    updatePreferences: vi.fn(),
  }),
  notifyPreferencesChanged: vi.fn(),
}));

vi.mock('@/features/tour/TourLauncher', () => ({
  TourLauncher: () => null,
}));

// Mock useStreamingAsk so we can control what the unified /ask endpoint returns.
vi.mock('../useStreamingAsk', async () => {
  const actual = await vi.importActual<typeof import('../useStreamingAsk')>('../useStreamingAsk');
  return {
    ...actual,
    useStreamingAsk: () => ({
      classified: null,
      isStreaming: false,
      error: null,
      ask: mockAsk,
      cancel: mockCancelAsk,
      clear: mockClearAsk,
    }),
  };
});

// executeBatch now lives inside useConversation, so mock it here too.
vi.mock('../useActionExecutor', async (importActual) => {
  const actual = await importActual<typeof import('../useActionExecutor')>();
  return {
    ...actual,
    executeBatch: (...args: unknown[]) => mockExecuteBatch(...args),
  };
});

import { CommandInput } from '../CommandInput';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommandInput (chat shell)', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  function getComposer() {
    // The composer textarea carries aria-label="Ask AI". The dialog title also has the
    // text "Ask AI", so we filter by role to disambiguate.
    return screen.getByRole('textbox', { name: 'Ask AI' }) as HTMLTextAreaElement;
  }

  it('renders the composer and empty-state examples when there are no turns', () => {
    render(<CommandInput {...defaultProps} />);

    expect(getComposer()).toBeDefined();
    expect(screen.getByLabelText('Send')).toBeDefined();
    // Empty-state example list — at least one known example from the default (non-scoped) list
    expect(screen.getByText(/Where is the cordless drill/)).toBeDefined();
    expect(screen.getByText(/Duplicate the Power Tools/)).toBeDefined();
  });

  it('submits typed text via Cmd+Enter and calls the mocked streaming ask', async () => {
    mockAsk.mockResolvedValue({ answer: 'pending', matches: [] });
    render(<CommandInput {...defaultProps} />);

    const textarea = getComposer();
    fireEvent.change(textarea, { target: { value: 'where is the tape?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(mockAsk).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'where is the tape?', locationId: 'loc-1' }),
      );
    });
  });

  it('renders the query answer in the thread when the stream returns answer + matches', async () => {
    mockAsk.mockResolvedValue({
      answer: 'Glass cleaner is in the Kitchen bin.',
      matches: [
        {
          bin_id: 'b-kitchen',
          name: 'Kitchen Supplies',
          area_name: 'Kitchen',
          items: ['glass cleaner', 'sponges'],
          tags: [],
          relevance: 'Contains glass cleaner',
        },
      ],
    });

    render(<CommandInput {...defaultProps} />);

    fireEvent.change(getComposer(), { target: { value: 'where is glass cleaner?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Glass cleaner is in the Kitchen bin.')).toBeDefined();
    });
    expect(screen.getByText('Kitchen Supplies')).toBeDefined();
  });

  it('renders an Apply button in the thread when the stream returns actions', async () => {
    mockAsk.mockResolvedValue({
      actions: [
        { type: 'add_items', bin_id: 'b1', bin_name: 'Tools', items: ['Hammer'] },
      ],
      interpretation: 'Add hammer to Tools',
    });

    render(<CommandInput {...defaultProps} />);

    fireEvent.change(getComposer(), { target: { value: 'add hammer to tools' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Add hammer to Tools')).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Apply/ })).toBeDefined();
    });
  });

  it('clicking Apply calls executeBatch with the selected actions and locationId', async () => {
    const action = { type: 'add_items', bin_id: 'b1', bin_name: 'Tools', items: ['Hammer'] };
    mockAsk.mockResolvedValue({
      actions: [action],
      interpretation: 'Add hammer to Tools',
    });
    mockExecuteBatch.mockResolvedValue({
      completedActions: [action],
      completedActionIndices: [0],
      createdBins: [],
      failedCount: 0,
    });

    render(<CommandInput {...defaultProps} />);

    fireEvent.change(getComposer(), { target: { value: 'add hammer to tools' } });
    fireEvent.click(screen.getByLabelText('Send'));

    const applyButton = await screen.findByRole('button', { name: /^Apply/ });

    await act(async () => {
      fireEvent.click(applyButton);
    });

    expect(mockExecuteBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [action],
        selectedIndices: [0],
        locationId: 'loc-1',
      }),
    );
  });

  it('closing the dialog clears state so re-opening shows the empty state again', async () => {
    mockAsk.mockResolvedValue({ answer: 'Found it.', matches: [] });

    const onOpenChange = vi.fn();
    const { rerender } = render(<CommandInput open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(getComposer(), { target: { value: 'where is the tape?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Found it.')).toBeDefined();
    });

    // Simulate user closing the dialog
    rerender(<CommandInput open={false} onOpenChange={onOpenChange} />);
    // Re-open
    rerender(<CommandInput open={true} onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(screen.getByText(/Where is the cordless drill/)).toBeDefined();
    });
    expect(screen.queryByText('Found it.')).toBeNull();
  });

  it('navigates to the bin when a query match is clicked and closes the dialog', async () => {
    mockAsk.mockResolvedValue({
      answer: 'Found it in Kitchen.',
      matches: [
        {
          bin_id: 'b-kitchen',
          name: 'Kitchen Supplies',
          area_name: 'Kitchen',
          items: ['glass cleaner'],
          tags: [],
          relevance: 'Match',
        },
      ],
    });

    const onOpenChange = vi.fn();
    render(<CommandInput open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(getComposer(), { target: { value: 'where is glass cleaner?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Kitchen Supplies')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Kitchen Supplies'));

    expect(mockNavigate).toHaveBeenCalledWith('/bin/b-kitchen', {
      state: { backLabel: 'Bins', backPath: '/bins' },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a "New chat" button only after the conversation has turns', async () => {
    mockAsk.mockResolvedValue({ answer: 'Found it.', matches: [] });
    render(<CommandInput {...defaultProps} />);

    // Empty state: no button yet — nothing to reset.
    expect(screen.queryByLabelText('New chat')).toBeNull();

    fireEvent.change(getComposer(), { target: { value: 'where is the tape?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Found it.')).toBeDefined();
    });

    // With turns present, the button is visible.
    expect(screen.getByLabelText('New chat')).toBeDefined();
  });

  it('clicking "New chat" abandons the current chat and restores the empty state', async () => {
    mockAsk.mockResolvedValue({ answer: 'Found it.', matches: [] });
    render(<CommandInput {...defaultProps} />);

    fireEvent.change(getComposer(), { target: { value: 'where is the tape?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Found it.')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('New chat'));

    // Previous answer is gone and the empty-state examples return.
    expect(screen.queryByText('Found it.')).toBeNull();
    expect(screen.getByText(/Where is the cordless drill/)).toBeDefined();
    // And the button hides itself since there are no turns to reset.
    expect(screen.queryByLabelText('New chat')).toBeNull();
  });

  it('clicking "New chat" while a request is in flight aborts the stream and clears the thread', async () => {
    let resolveAsk: ((v: unknown) => void) | null = null;
    mockAsk.mockImplementationOnce(
      () => new Promise((res) => { resolveAsk = res; }),
    );

    render(<CommandInput {...defaultProps} />);

    fireEvent.change(getComposer(), { target: { value: 'slow query' } });
    fireEvent.click(screen.getByLabelText('Send'));

    // The thinking turn flushes and the "New chat" button becomes available.
    await waitFor(() => {
      expect(screen.getByLabelText('New chat')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('New chat'));

    expect(mockCancelAsk).toHaveBeenCalled();
    // Empty state is back — the in-flight request is abandoned.
    expect(screen.getByText(/Where is the cordless drill/)).toBeDefined();
    expect(screen.queryByLabelText('New chat')).toBeNull();

    // Release the hanging promise so no dangling handlers.
    if (resolveAsk) (resolveAsk as (v: unknown) => void)({ answer: 'late', matches: [] });
  });

  it('shows an error turn with a Retry button when the stream rejects, and Retry re-invokes ask', async () => {
    // Plain Error → mapAiError falls back to 'Request failed'. The retry path then
    // resolves, so the error turn is replaced by a successful answer.
    mockAsk.mockRejectedValueOnce(new Error('network boom'));
    mockAsk.mockResolvedValueOnce({ answer: 'Recovered.', matches: [] });

    render(<CommandInput {...defaultProps} />);

    const textarea = getComposer();
    fireEvent.change(textarea, { target: { value: 'where is the tape?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    const retryButton = await screen.findByRole('button', { name: /retry/i });
    expect(screen.getByText(/Request failed/i)).toBeDefined();

    await act(async () => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Recovered.')).toBeDefined();
    });
    expect(mockAsk).toHaveBeenCalledTimes(2);
  });
});
