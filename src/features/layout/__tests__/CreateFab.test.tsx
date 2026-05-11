import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateFab } from '../CreateFab';
import { CreateFabProvider, type CreateFabSuppression } from '../CreateFabContext';

vi.mock('@/lib/usePermissions', () => ({
  usePermissions: vi.fn(() => ({ canCreateBin: true })),
}));

vi.mock('@/lib/usePlan', () => ({
  usePlan: vi.fn(() => ({ isLocked: false, isSelfHosted: false })),
}));

vi.mock('@/lib/terminology', () => ({
  useTerminology: vi.fn(() => ({ Bin: 'Bin', bin: 'bin' })),
}));

interface HarnessProps {
  pathname: string;
  suppression?: Partial<CreateFabSuppression>;
}

function Harness({ pathname, suppression }: HarnessProps) {
  const merged: CreateFabSuppression = {
    scanDialogOpen: false,
    onboardingActive: false,
    thinGateActive: false,
    tourActive: false,
    ...suppression,
  };
  return (
    <MemoryRouter initialEntries={[pathname]}>
      <CreateFabProvider {...merged}>
        <CreateFab />
      </CreateFabProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CreateFab visibility (hidden cases)', () => {
  beforeEach(async () => {
    const { usePermissions } = await import('@/lib/usePermissions');
    const { usePlan } = await import('@/lib/usePlan');
    vi.mocked(usePermissions).mockReturnValue({ canCreateBin: true } as ReturnType<typeof usePermissions>);
    vi.mocked(usePlan).mockReturnValue({ isLocked: false, isSelfHosted: false } as ReturnType<typeof usePlan>);
  });

  it.each([
    ['/capture'],
    ['/new-bin'],
    ['/scan'],
    ['/admin/users'],
    ['/admin/system'],
  ])('renders nothing on %s', (pathname) => {
    const { container } = render(<Harness pathname={pathname} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when scan dialog is open', () => {
    const { container } = render(<Harness pathname="/bins" suppression={{ scanDialogOpen: true }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing during onboarding', () => {
    const { container } = render(<Harness pathname="/bins" suppression={{ onboardingActive: true }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when thin-gate is active', () => {
    const { container } = render(<Harness pathname="/bins" suppression={{ thinGateActive: true }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when a tour is active', () => {
    const { container } = render(<Harness pathname="/bins" suppression={{ tourActive: true }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for viewers (canCreateBin=false)', async () => {
    const { usePermissions } = await import('@/lib/usePermissions');
    vi.mocked(usePermissions).mockReturnValue({ canCreateBin: false } as ReturnType<typeof usePermissions>);
    const { container } = render(<Harness pathname="/bins" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the cloud plan is locked', async () => {
    const { usePlan } = await import('@/lib/usePlan');
    vi.mocked(usePlan).mockReturnValue({ isLocked: true, isSelfHosted: false } as ReturnType<typeof usePlan>);
    const { container } = render(<Harness pathname="/bins" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when locked but self-hosted (no lock on self-host)', async () => {
    const { usePlan } = await import('@/lib/usePlan');
    vi.mocked(usePlan).mockReturnValue({ isLocked: true, isSelfHosted: true } as ReturnType<typeof usePlan>);
    const { container } = render(<Harness pathname="/bins" />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('CreateFab closed state', () => {
  beforeEach(async () => {
    const { usePermissions } = await import('@/lib/usePermissions');
    const { usePlan } = await import('@/lib/usePlan');
    const { useTerminology } = await import('@/lib/terminology');
    vi.mocked(usePermissions).mockReturnValue({ canCreateBin: true } as ReturnType<typeof usePermissions>);
    vi.mocked(usePlan).mockReturnValue({ isLocked: false, isSelfHosted: false } as ReturnType<typeof usePlan>);
    vi.mocked(useTerminology).mockReturnValue({
      bin: 'bin',
      bins: 'bins',
      Bin: 'Bin',
      Bins: 'Bins',
      location: 'location',
      locations: 'locations',
      Location: 'Location',
      Locations: 'Locations',
      area: 'area',
      areas: 'areas',
      Area: 'Area',
      Areas: 'Areas',
    });
  });

  it('renders a button on /bins', () => {
    render(<Harness pathname="/bins" />);
    expect(screen.getByRole('button', { name: /create bin/i })).toBeInTheDocument();
  });

  it('renders on /settings/preferences (settings show the FAB)', () => {
    render(<Harness pathname="/settings/preferences" />);
    expect(screen.getByRole('button', { name: /create bin/i })).toBeInTheDocument();
  });

  it('uses the active location terminology in the aria-label', async () => {
    const { useTerminology } = await import('@/lib/terminology');
    vi.mocked(useTerminology).mockReturnValue({
      bin: 'box',
      bins: 'boxes',
      Bin: 'Box',
      Bins: 'Boxes',
      location: 'location',
      locations: 'locations',
      Location: 'Location',
      Locations: 'Locations',
      area: 'area',
      areas: 'areas',
      Area: 'Area',
      Areas: 'Areas',
    });
    render(<Harness pathname="/bins" />);
    expect(screen.getByRole('button', { name: /create box/i })).toBeInTheDocument();
  });

  it('starts with aria-expanded="false"', () => {
    render(<Harness pathname="/bins" />);
    expect(screen.getByRole('button', { name: /create/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CreateFab speed dial', () => {
  beforeEach(async () => {
    const { usePermissions } = await import('@/lib/usePermissions');
    const { usePlan } = await import('@/lib/usePlan');
    const { useTerminology } = await import('@/lib/terminology');
    vi.mocked(usePermissions).mockReturnValue({ canCreateBin: true } as ReturnType<typeof usePermissions>);
    vi.mocked(usePlan).mockReturnValue({ isLocked: false, isSelfHosted: false } as ReturnType<typeof usePlan>);
    vi.mocked(useTerminology).mockReturnValue({
      bin: 'bin',
      bins: 'bins',
      Bin: 'Bin',
      Bins: 'Bins',
      location: 'location',
      locations: 'locations',
      Location: 'Location',
      Locations: 'Locations',
      area: 'area',
      areas: 'areas',
      Area: 'Area',
      Areas: 'Areas',
    });
  });

  it('does not show pill menu items by default', () => {
    render(<Harness pathname="/bins" />);
    expect(screen.queryByRole('menuitem', { name: /new bin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /add from photos/i })).not.toBeInTheDocument();
  });

  it('opens the speed dial when the FAB is tapped', () => {
    render(<Harness pathname="/bins" />);
    fireEvent.click(screen.getByRole('button', { name: /create bin/i }));
    expect(screen.getByRole('button', { name: /create bin/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /new bin/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /add from photos/i })).toBeInTheDocument();
  });

  it('closes the speed dial when the FAB is tapped again', () => {
    render(<Harness pathname="/bins" />);
    const fab = screen.getByRole('button', { name: /create bin/i });
    fireEvent.click(fab);
    fireEvent.click(fab);
    expect(fab).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menuitem', { name: /new bin/i })).not.toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    render(<Harness pathname="/bins" />);
    fireEvent.click(screen.getByRole('button', { name: /create bin/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /create bin/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the backdrop is clicked', () => {
    render(<Harness pathname="/bins" />);
    fireEvent.click(screen.getByRole('button', { name: /create bin/i }));
    fireEvent.click(screen.getByTestId('create-fab-backdrop'));
    expect(screen.getByRole('button', { name: /create bin/i })).toHaveAttribute('aria-expanded', 'false');
  });
});
