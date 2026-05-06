import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { AdminUserOverrides } from './useAdminUserOverrides';

interface AdminUserCreditsCardProps {
  overrides: AdminUserOverrides;
}

export function AdminUserCreditsCard({ overrides }: AdminUserCreditsCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Credits</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
          <div className="row-spread py-3 first:pt-0">
            <span className="text-[14px] text-[var(--text-secondary)]">Grant credits</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={10000}
                placeholder="Amount"
                value={overrides.grantAmount}
                onChange={(e) => overrides.setGrantAmount(e.target.value)}
                className="w-24 h-8 text-[14px]"
              />
              <Button size="sm" onClick={overrides.handleGrantCredits} disabled={!overrides.grantAmount}>Grant</Button>
            </div>
          </div>
          <div className="row-spread py-3 last:pb-0">
            <span className="text-[14px] text-[var(--text-secondary)]">Reset credits to 0</span>
            <Button variant="outline" size="sm" onClick={overrides.handleResetCredits}>Reset</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
