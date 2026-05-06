import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversation } from '../useConversation';

const mockAsk = vi.fn();
const mockExecuteBatch = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../useStreamingAsk', async () => {
  const actual = await vi.importActual<typeof import('../useStreamingAsk')>('../useStreamingAsk');
  return {
    ...actual,
    useStreamingAsk: () => ({
      classified: null,
      isStreaming: false,
      error: null,
      ask: mockAsk,
      cancel: vi.fn(),
      clear: vi.fn(),
    }),
  };
});

vi.mock('../useActionExecutor', async (importActual) => {
  const actual = await importActual<typeof import('../useActionExecutor')>();
  return {
    ...actual,
    executeBatch: (...args: unknown[]) => mockExecuteBatch(...args),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ activeLocationId: 'loc-1' }),
}));

vi.mock('@/features/bins/useBins', () => ({
  useBinList: () => ({ bins: [], isLoading: false, refresh: vi.fn() }),
  notifyBinsChanged: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { ai_asked_at: null },
    isLoading: false,
    updatePreferences: vi.fn(),
  }),
  notifyPreferencesChanged: vi.fn(),
}));

describe('useConversation - ask flow', () => {
  beforeEach(() => {
    mockAsk.mockReset();
  });

  it('starts with an empty turns array', () => {
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    expect(result.current.turns).toEqual([]);
  });

  it('appends a user-text turn immediately when ask() is called', async () => {
    mockAsk.mockResolvedValue({ answer: 'ok', matches: [] });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('find batteries');
    });

    const userTurns = result.current.turns.filter((t) => t.kind === 'user-text');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]).toMatchObject({ text: 'find batteries' });
  });

  it('appends a query-result turn after the AI responds with an answer', async () => {
    mockAsk.mockResolvedValue({ answer: 'In the drawer', matches: [] });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('find batteries');
    });

    await waitFor(() => {
      const queryTurns = result.current.turns.filter((t) => t.kind === 'ai-query-result');
      expect(queryTurns).toHaveLength(1);
    });
  });

  it('appends a command-preview turn when the AI responds with actions', async () => {
    mockAsk.mockResolvedValue({
      actions: [{ type: 'create_bin', name: 'X' }],
      interpretation: 'Create X',
    });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('create X');
    });

    await waitFor(() => {
      const previews = result.current.turns.filter((t) => t.kind === 'ai-command-preview');
      expect(previews).toHaveLength(1);
      expect(previews[0]).toMatchObject({ status: 'pending', interpretation: 'Create X' });
    });
  });

  it('clears all turns when clearConversation is called', async () => {
    mockAsk.mockResolvedValue({ answer: 'ok', matches: [] });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('hi');
    });
    expect(result.current.turns.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearConversation();
    });
    expect(result.current.turns).toEqual([]);
  });

  it('sends history built from prior turns on subsequent asks', async () => {
    mockAsk.mockResolvedValue({ answer: 'first', matches: [] });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('find batteries');
    });
    mockAsk.mockClear();
    mockAsk.mockResolvedValue({ answer: 'second', matches: [] });

    await act(async () => {
      await result.current.ask('move them');
    });

    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'move them',
        history: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'find batteries' }),
        ]),
      }),
    );
  });

  it('ignores a second ask while the first is still in flight', async () => {
    let resolveFirst: ((v: unknown) => void) | null = null;
    mockAsk.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    // First ask — hangs on the unresolved promise.
    const firstPromise = act(async () => {
      await result.current.ask('first');
    });
    // Let the initial setTurns flush.
    await new Promise((r) => setTimeout(r, 0));

    // Second ask — should be a no-op until the first resolves.
    await act(async () => {
      await result.current.ask('second');
    });

    // Only the first user-text turn should be present; "second" never entered the thread.
    const userTexts = result.current.turns
      .filter((t) => t.kind === 'user-text')
      .map((t) => (t.kind === 'user-text' ? t.text : ''));
    expect(userTexts).toEqual(['first']);
    expect(mockAsk).toHaveBeenCalledTimes(1);

    // Release the first so the test doesn't leave a dangling timer.
    if (resolveFirst) (resolveFirst as (v: unknown) => void)({ answer: 'ok', matches: [] });
    await firstPromise;
  });
});

describe('useConversation - actions', () => {
  beforeEach(() => {
    mockAsk.mockReset();
    mockExecuteBatch.mockReset();
  });

  it('toggles a checked action on a command-preview turn', async () => {
    mockAsk.mockResolvedValue({
      actions: [
        { type: 'create_bin', name: 'X' },
        { type: 'create_bin', name: 'Y' },
      ],
      interpretation: '',
    });
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.ask('create X and Y');
    });
    const preview = result.current.turns.find((t) => t.kind === 'ai-command-preview');
    if (!preview || preview.kind !== 'ai-command-preview') throw new Error('expected preview');

    act(() => {
      result.current.toggleAction(preview.id, 0);
    });
    const updated = result.current.turns.find((t) => t.id === preview.id);
    if (!updated || updated.kind !== 'ai-command-preview') throw new Error('expected preview');
    expect(updated.checkedActions.get(0)).toBe(false);
    expect(updated.checkedActions.get(1)).toBe(true);
  });

  it('executes actions and transitions status pending -> executing -> executed', async () => {
    const actionA = { type: 'create_bin', name: 'X' } as never;
    mockAsk.mockResolvedValue({ actions: [actionA], interpretation: 'Create X' });
    mockExecuteBatch.mockResolvedValue({
      completedActions: [actionA],
      completedActionIndices: [0],
      createdBins: [{ id: 'b1', name: 'X', icon: '', color: '' }],
      failedCount: 0,
    });

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    await act(async () => {
      await result.current.ask('create X');
    });

    const preview = result.current.turns.find((t) => t.kind === 'ai-command-preview');
    if (!preview) throw new Error('expected preview');

    await act(async () => {
      await result.current.executeActions(preview.id);
    });

    const executed = result.current.turns.find((t) => t.id === preview.id);
    if (!executed || executed.kind !== 'ai-command-preview') throw new Error('expected preview');
    expect(executed.status).toBe('executed');
    expect(executed.executionResult?.completedActionIndices).toEqual([0]);
  });

  it('rolls back to pending status when executeBatch throws', async () => {
    const actionA = { type: 'create_bin', name: 'X' } as never;
    mockAsk.mockResolvedValue({ actions: [actionA], interpretation: 'Create X' });
    mockExecuteBatch.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    await act(async () => { await result.current.ask('create X'); });

    const preview = result.current.turns.find((t) => t.kind === 'ai-command-preview');
    if (!preview) throw new Error('expected preview');

    await act(async () => { await result.current.executeActions(preview.id); });

    const rolledBack = result.current.turns.find((t) => t.id === preview.id);
    if (!rolledBack || rolledBack.kind !== 'ai-command-preview') throw new Error('expected preview');
    expect(rolledBack.status).toBe('pending');
    expect(rolledBack.executionResult).toBeUndefined();
  });

  it('ignores a second concurrent executeActions call', async () => {
    const actionA = { type: 'create_bin', name: 'X' } as never;
    const actionB = { type: 'create_bin', name: 'Y' } as never;
    mockAsk.mockResolvedValueOnce({ actions: [actionA], interpretation: '' });
    mockAsk.mockResolvedValueOnce({ actions: [actionB], interpretation: '' });

    let resolveFirst: ((v: unknown) => void) | null = null;
    mockExecuteBatch.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    await act(async () => { await result.current.ask('first'); });
    await act(async () => { await result.current.ask('second'); });

    const previews = result.current.turns.filter((t) => t.kind === 'ai-command-preview');
    expect(previews).toHaveLength(2);

    // Start the first execution (which will hang until we resolve it)
    const firstExecPromise = act(async () => { await result.current.executeActions(previews[0].id); });
    // Immediately attempt the second — must be a no-op
    await act(async () => { await result.current.executeActions(previews[1].id); });

    // executeBatch should have been called exactly once (for the first turn)
    expect(mockExecuteBatch).toHaveBeenCalledTimes(1);

    // Finish the first
    const resolver = resolveFirst as ((v: unknown) => void) | null;
    if (resolver) resolver({ completedActions: [actionA], completedActionIndices: [0], createdBins: [], failedCount: 0 });
    await firstExecPromise;
  });
});

describe('useConversation - cancel & retry', () => {
  beforeEach(() => {
    mockAsk.mockReset();
    mockExecuteBatch.mockReset();
    mockShowToast.mockReset();
  });

  it('removes the in-flight thinking turn when cancelStreaming is called', async () => {
    let resolveAsk: ((value: unknown) => void) | null = null;
    mockAsk.mockImplementation(() => new Promise((res) => { resolveAsk = res; }));

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    const askPromise = act(async () => { await result.current.ask('please'); });

    // Give the microtask a tick to let the setTurns with the thinking turn flush
    await new Promise((r) => setTimeout(r, 0));
    const thinking = result.current.turns.find((t) => t.kind === 'ai-thinking');
    expect(thinking).toBeDefined();

    act(() => { result.current.cancelStreaming(); });

    if (resolveAsk) (resolveAsk as (v: unknown) => void)(null);
    await askPromise;

    expect(result.current.turns.find((t) => t.kind === 'ai-thinking')).toBeUndefined();
  });

  it('retries a failed turn by re-asking with the original text', async () => {
    mockAsk.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));

    await act(async () => { await result.current.ask('hi'); });
    const errTurn = result.current.turns.find((t) => t.kind === 'ai-error');
    if (!errTurn) throw new Error('expected error turn');

    // Now set up a successful second attempt
    mockAsk.mockResolvedValueOnce({ answer: 'retried', matches: [] });
    await act(async () => { await result.current.retry(errTurn.id); });

    // After retry, we should see a successful query-result turn and no more error turn
    expect(result.current.turns.find((t) => t.kind === 'ai-query-result')).toBeDefined();
    expect(result.current.turns.find((t) => t.kind === 'ai-error')).toBeUndefined();
    // The second ask call should have sent 'hi' as the text
    expect(mockAsk).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'hi' }));
  });

  it('does not produce a toast or error turn on cancel', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    mockAsk.mockImplementation(() => Promise.reject(abortErr));

    const { result } = renderHook(() => useConversation({ locationId: 'loc-1' }));
    await act(async () => { await result.current.ask('go'); });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(result.current.turns.find((t) => t.kind === 'ai-error')).toBeUndefined();
  });
});
