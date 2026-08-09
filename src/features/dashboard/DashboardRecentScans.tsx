import type { TFunction } from 'i18next';
import { ScanLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BinIconBadge } from '@/components/ui/bin-icon-badge';
import { resolveColor } from '@/lib/colorPalette';
import { resolveIcon } from '@/lib/iconMap';
import { cn, flatCard, plural, relativeTime } from '@/lib/utils';
import type { Bin } from '@/types';
import { SectionHeader } from './DashboardWidgets';

interface DashboardRecentScansProps {
  bins: Bin[];
  scanTimeMap: Map<string, string>;
  limit?: number;
  showTimestamps?: boolean;
}

function describeBin(bin: Bin, t: TFunction<'common'>): string {
  const itemCount = bin.items?.length ?? 0;
  const itemPart = itemCount > 0
    ? t('itemCount', { count: itemCount, defaultValue: `${itemCount} ${plural(itemCount, 'item')}` })
    : 'Empty';
  return bin.area_name ? `${bin.area_name} · ${itemPart}` : itemPart;
}

export function DashboardRecentScans({ bins, scanTimeMap, limit = 3, showTimestamps = true }: DashboardRecentScansProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const rows = bins.slice(0, limit);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="dash-recent-scans" className="flex flex-col gap-2">
      <SectionHeader id="dash-recent-scans" icon={ScanLine} title="Recent scans" />
      <div className={cn(flatCard, 'p-2')}>
        <ul className="flex flex-col">
          {rows.map((bin) => {
            const Icon = resolveIcon(bin.icon);
            const colorPreset = resolveColor(bin.color);
            const time = scanTimeMap.get(bin.id);
            const tagPreview = bin.tags?.slice(0, 1) ?? [];
            return (
              <li key={bin.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/bin/${bin.id}`)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 min-h-[52px] rounded-[var(--radius-sm)] text-left transition-colors duration-150 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <BinIconBadge icon={Icon} colorPreset={colorPreset} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[13.5px] font-medium text-[var(--text-primary)] truncate leading-snug">
                        {bin.name}
                      </p>
                      {tagPreview.length > 0 && (
                        <span className="shrink-0 text-[10.5px] font-medium text-[var(--text-tertiary)] px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-input)] truncate max-w-[5rem]">
                          {tagPreview[0]}
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-[var(--text-tertiary)] truncate leading-snug">
                      {describeBin(bin, t)}
                    </p>
                  </div>
                  {showTimestamps && time && (
                    <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                      {relativeTime(time)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
