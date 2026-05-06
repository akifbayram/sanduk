import { Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getCommandInputRef } from '@/features/tour/TourProvider';
import { cn, focusRing } from '@/lib/utils';
import { ChecklistItem } from './ChecklistItem';
import { useChecklist } from './useChecklist';

interface DashboardChecklistProps {
  totalBins: number;
  setCreateOpen: (open: boolean) => void;
  onUpgradeClick?: () => void;
}

export function DashboardChecklist({ totalBins, setCreateOpen, onUpgradeClick }: DashboardChecklistProps) {
  const navigate = useNavigate();
  const { steps, completedCount, isHidden, dismiss } = useChecklist({ totalBins });

  if (isHidden) return null;

  function buildActions(stepId: string, gated?: boolean) {
    if (stepId === 'create-bin') {
      return {
        primary: { label: 'Take a photo', onClick: () => setCreateOpen(true) },
        secondary: { label: 'Add manually', onClick: () => setCreateOpen(true) },
      };
    }
    if (stepId === 'add-three-bins') {
      return { primary: { label: 'Add another', onClick: () => setCreateOpen(true) } };
    }
    if (stepId === 'ask-ai') {
      return {
        primary: {
          label: 'Try it',
          onClick: () => {
            if (gated && onUpgradeClick) onUpgradeClick();
            else getCommandInputRef().current?.open();
          },
        },
      };
    }
    if (stepId === 'print-label') {
      return { primary: { label: 'Open print', onClick: () => navigate('/print') } };
    }
    return {};
  }

  return (
    <section
      aria-labelledby="dash-checklist"
      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <h2 id="dash-checklist" className="text-[15px] font-semibold text-[var(--text-primary)]">
            Get started
          </h2>
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {completedCount} of {steps.length}
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss checklist"
          className={cn(
            'h-7 w-7 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-colors',
            focusRing,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {steps.map((step) => {
          const { primary, secondary } = buildActions(step.id, step.gated);
          return (
            <ChecklistItem
              key={step.id}
              icon={step.icon}
              title={step.title}
              description={step.description}
              complete={step.complete}
              primary={primary}
              secondary={secondary}
            />
          );
        })}
      </div>
    </section>
  );
}
