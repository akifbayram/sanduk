import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Events, notify } from '@/lib/eventBus';
import { useTerminology } from '@/lib/terminology';
import { useUserPreferences } from '@/lib/userPreferences';
import type { Location } from '@/types';

export function ThinLocationGate() {
  const t = useTerminology();
  const { setActiveLocationId } = useAuth();
  const { updatePreferences } = useUserPreferences();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const location = await apiFetch<Location>('/api/locations', {
        method: 'POST',
        body: { name: name.trim() },
      });
      setActiveLocationId(location.id);
      updatePreferences({
        checklist_eligible: true,
        onboarding_completed: true,
        onboarding_location_id: location.id,
      });
      notify(Events.LOCATIONS);
    } catch (_err) {
      setError("Couldn't create the location. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-backdrop)]">
      <div className="flat-heavy rounded-[var(--radius-xl)] w-full max-w-sm mx-5 px-8 py-8">
        <h1 className="text-[20px] font-semibold text-[var(--text-primary)] mb-1">
          Name your first {t.location}
        </h1>
        <p className="text-[14px] text-[var(--text-tertiary)] mb-5">
          Home, garage, office — whatever fits.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="thin-gate-name">Name</Label>
            <Input
              id="thin-gate-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Home"
              disabled={loading}
            />
          </div>
          {error && <p className="text-[13px] text-[var(--color-error)]">{error}</p>}
          <Button type="submit" disabled={!name.trim() || loading}>
            {loading ? 'Creating…' : `Create ${t.location}`}
          </Button>
        </form>
      </div>
    </div>
  );
}
