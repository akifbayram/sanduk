import { SlidersHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionGroup } from '@/components/ui/option-group';
import { Textarea } from '@/components/ui/textarea';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';
import type { ReorganizeBinsForm } from './useReorganizeBinsForm';

interface Props {
  form: ReorganizeBinsForm;
  itemCount: number;
}

interface OptionField {
  legend: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}

export function ReorganizeBinsOptions({ form, itemCount }: Props) {
  const t = useTerminology();

  const optionFields: OptionField[] = useMemo(
    () => [
      {
        legend: 'Change level',
        options: [
          { key: 'conservative', label: 'Light' },
          { key: 'moderate', label: 'Moderate' },
          { key: 'aggressive', label: 'Thorough' },
        ],
        value: form.strictness,
        onChange: (v) => form.setStrictness(v as ReorganizeBinsForm['strictness']),
        hint: `How much the AI can restructure your ${t.bins}`,
      },
      {
        legend: 'Grouping',
        options: [
          { key: 'broad', label: 'Broad' },
          { key: 'medium', label: 'Medium' },
          { key: 'specific', label: 'Specific' },
        ],
        value: form.granularity,
        onChange: (v) => form.setGranularity(v as ReorganizeBinsForm['granularity']),
        hint: 'How narrowly items are categorized',
      },
      {
        legend: 'Unmatched items',
        options: [
          { key: 'best-fit', label: 'Best match' },
          { key: 'multi-bin', label: 'Place in multiple' },
          { key: 'misc-bin', label: `Misc ${t.bin}` },
        ],
        value: form.ambiguousPolicy,
        onChange: (v) => form.setAmbiguousPolicy(v as ReorganizeBinsForm['ambiguousPolicy']),
        hint: "What happens to items that don't fit neatly",
      },
      {
        legend: 'Duplicate items',
        options: [
          { key: 'force-single', label: `One ${t.bin} only` },
          { key: 'allow', label: 'Allow copies' },
        ],
        value: form.duplicates,
        onChange: (v) => form.setDuplicates(v as ReorganizeBinsForm['duplicates']),
      },
      {
        legend: 'Outlier items',
        options: [
          { key: 'force-closest', label: 'Nearest match' },
          { key: 'dedicated', label: `Separate ${t.bin}` },
        ],
        value: form.outliers,
        onChange: (v) => form.setOutliers(v as ReorganizeBinsForm['outliers']),
      },
    ],
    [form, t.bin, t.bins],
  );

  return (
    <Disclosure
      label={
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-tertiary)]" />
          <Label className="text-[15px] font-semibold text-[var(--text-primary)] pointer-events-none">
            Options
          </Label>
        </span>
      }
    >
      <div className="space-y-5">
        <div>
          <Label
            htmlFor="reorg-max-bins"
            className="text-[12px] text-[var(--text-secondary)] font-medium block mb-2"
          >
            Number of {t.bins}
          </Label>
          <Input
            id="reorg-max-bins"
            type="number"
            min={1}
            value={form.maxBins}
            onChange={(e) => form.setMaxBins(e.target.value)}
            placeholder="Auto"
            aria-describedby={form.maxBinsError ? 'reorg-max-bins-error' : undefined}
            aria-invalid={!!form.maxBinsError}
          />
          {form.maxBinsError && (
            <p
              id="reorg-max-bins-error"
              className="text-[12px] text-[var(--destructive)] mt-1"
              role="alert"
            >
              {form.maxBinsError}
            </p>
          )}
        </div>

        <div>
          <Label
            htmlFor="reorg-min-items"
            className="text-[12px] text-[var(--text-secondary)] font-medium block mb-2"
          >
            Items per {t.bin}
          </Label>
          <div className="flex gap-2">
            <Input
              id="reorg-min-items"
              type="number"
              min={1}
              value={form.minItemsPerBin}
              onChange={(e) => form.setMinItemsPerBin(e.target.value)}
              placeholder="Min"
              aria-invalid={!!form.rangeError}
            />
            <Input
              id="reorg-max-items"
              type="number"
              min={1}
              value={form.maxItemsPerBin}
              onChange={(e) => form.setMaxItemsPerBin(e.target.value)}
              placeholder="Max"
              aria-label={`Max items per ${t.bin}`}
              aria-invalid={!!form.rangeError}
            />
          </div>
          {form.rangeError && (
            <p className="text-[12px] text-[var(--destructive)] mt-1" role="alert">
              {form.rangeError}
            </p>
          )}
        </div>

        <div>
          <Label
            htmlFor="reorg-notes"
            className="text-[12px] text-[var(--text-secondary)] font-medium block mb-2"
          >
            Additional instructions
          </Label>
          <Textarea
            id="reorg-notes"
            value={form.userNotes}
            onChange={(e) => form.setUserNotes(e.target.value)}
            placeholder="e.g. Keep kitchen items separate from garage tools"
            rows={2}
          />
        </div>

        {optionFields.map((field) => (
          <fieldset key={field.legend} className="border-0 m-0 px-0 pt-0 pb-2">
            <legend
              className={cn(
                'text-[12px] text-[var(--text-secondary)] font-medium block p-0',
                !field.hint && 'mb-2',
              )}
            >
              {field.legend}
            </legend>
            {field.hint && (
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 mb-2">{field.hint}</p>
            )}
            <OptionGroup
              options={field.options}
              value={field.value}
              onChange={field.onChange}
              size="sm"
            />
          </fieldset>
        ))}

        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--text-tertiary)]">
          {itemCount} item{itemCount !== 1 ? 's' : ''} across selected {t.bins}
        </div>
      </div>
    </Disclosure>
  );
}
