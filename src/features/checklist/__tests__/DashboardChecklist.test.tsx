import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardChecklist } from '../DashboardChecklist';

vi.mock('../useChecklist', () => ({
  useChecklist: vi.fn(),
}));
vi.mock('@/features/tour/TourProvider', () => ({
  getCommandInputRef: () => ({ current: { open: vi.fn() } }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { useChecklist } from '../useChecklist';

const mockedUseChecklist = vi.mocked(useChecklist);

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardChecklist', () => {
  it('renders nothing when isHidden is true', () => {
    mockedUseChecklist.mockReturnValue({
      steps: [],
      completedCount: 0,
      isHidden: true,
      dismiss: vi.fn(),
    });
    const { container } = render(
      <DashboardChecklist totalBins={0} setCreateOpen={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the four step rows when visible', () => {
    mockedUseChecklist.mockReturnValue({
      steps: [
        { id: 'create-bin', title: 'Add your first bin', description: 'a', icon: () => null as any, isComplete: () => false, complete: false },
        { id: 'add-three-bins', title: 'Build out your shelf', description: 'b', icon: () => null as any, isComplete: () => false, complete: false },
        { id: 'ask-ai', title: 'Ask AI to find something', description: 'c', icon: () => null as any, isComplete: () => false, complete: false },
        { id: 'print-label', title: 'Print your first label', description: 'd', icon: () => null as any, isComplete: () => false, complete: false },
      ] as any,
      completedCount: 0,
      isHidden: false,
      dismiss: vi.fn(),
    });
    render(<DashboardChecklist totalBins={0} setCreateOpen={vi.fn()} />);
    expect(screen.getByText('Add your first bin')).toBeTruthy();
    expect(screen.getByText('Build out your shelf')).toBeTruthy();
    expect(screen.getByText('Ask AI to find something')).toBeTruthy();
    expect(screen.getByText('Print your first label')).toBeTruthy();
  });

  it('× button calls dismiss', () => {
    const dismiss = vi.fn();
    mockedUseChecklist.mockReturnValue({
      steps: [
        { id: 'create-bin', title: 't', description: 'd', icon: () => null as any, isComplete: () => false, complete: false },
      ] as any,
      completedCount: 0,
      isHidden: false,
      dismiss,
    });
    render(<DashboardChecklist totalBins={0} setCreateOpen={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Dismiss checklist'));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
