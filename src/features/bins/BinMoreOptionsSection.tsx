import { Disclosure } from '@/components/ui/disclosure';
import { Textarea } from '@/components/ui/textarea';
import { AreaPicker } from '@/features/areas/AreaPicker';
import { getSecondaryColorInfo, setSecondaryColor } from '@/lib/cardStyle';
import { useTerminology } from '@/lib/terminology';
import { sectionHeader } from '@/lib/utils';
import type { BinItem, BinVisibility, CustomField } from '@/types';
import { BinPreviewCard } from './BinPreviewCard';
import { ColorPicker } from './ColorPicker';
import { CustomFieldsEditCard } from './CustomFieldsEditCard';
import { IconPicker } from './IconPicker';
import { StylePicker } from './StylePicker';
import { TagInput } from './TagInput';
import { VisibilityPicker } from './VisibilityPicker';

interface BinMoreOptionsSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  /** Field state */
  name: string;
  items: BinItem[];
  areaId: string | null;
  setAreaId: (id: string | null) => void;
  notes: string;
  setNotes: (notes: string) => void;
  tags: string[];
  setTags: (tags: string[]) => void;
  allTags?: string[];
  customFieldDefs: CustomField[];
  customFields: Record<string, string>;
  setCustomFields: (fields: Record<string, string>) => void;
  icon: string;
  setIcon: (icon: string) => void;
  color: string;
  setColor: (color: string) => void;
  cardStyle: string;
  setCardStyle: (style: string) => void;
  visibility: BinVisibility;
  setVisibility: (v: BinVisibility) => void;
  areaName: string;
}

/**
 * Optional fields collapsed under "More options" in full-mode bin creation:
 * area, notes, tags, custom fields, appearance (preview/icon/color/style),
 * and visibility.
 */
export function BinMoreOptionsSection({
  open,
  onOpenChange,
  locationId,
  name,
  items,
  areaId,
  setAreaId,
  notes,
  setNotes,
  tags,
  setTags,
  allTags,
  customFieldDefs,
  customFields,
  setCustomFields,
  icon,
  setIcon,
  color,
  setColor,
  cardStyle,
  setCardStyle,
  visibility,
  setVisibility,
  areaName,
}: BinMoreOptionsSectionProps) {
  const t = useTerminology();
  const secondaryInfo = getSecondaryColorInfo(cardStyle);

  return (
    <Disclosure
      label="More options"
      open={open}
      onOpenChange={onOpenChange}
      labelClassName="py-2 text-[var(--accent)] cursor-pointer"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <span className={sectionHeader}>{t.Area}</span>
          <AreaPicker locationId={locationId} value={areaId} onChange={setAreaId} />
        </div>

        <div className="space-y-2">
          <label htmlFor="bin-notes" className={sectionHeader}>Notes</label>
          <Textarea
            id="bin-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            maxLength={10000}
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <span className={sectionHeader}>Tags</span>
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
        </div>

        {customFieldDefs.length > 0 && (
          <div className="space-y-2">
            <span className={sectionHeader}>Custom Fields</span>
            <CustomFieldsEditCard
              fields={customFieldDefs}
              values={customFields}
              onChange={setCustomFields}
            />
          </div>
        )}

        <div className="space-y-3">
          <span className={sectionHeader}>Appearance</span>
          <BinPreviewCard
            name={name}
            color={color}
            items={items.map((i) => i.name)}
            tags={tags}
            icon={icon}
            cardStyle={cardStyle}
            areaName={areaName}
          />
          <div className="space-y-2">
            <span className="text-[12px] text-[var(--text-tertiary)]">Icon</span>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <div className="space-y-2">
            <span className="text-[12px] text-[var(--text-tertiary)]">Color</span>
            <ColorPicker
              value={color}
              onChange={setColor}
              secondaryLabel={secondaryInfo?.label}
              secondaryValue={secondaryInfo?.value}
              onSecondaryChange={secondaryInfo ? (c) => setCardStyle(setSecondaryColor(cardStyle, c)) : undefined}
            />
          </div>
          <div className="space-y-2">
            <span className="text-[12px] text-[var(--text-tertiary)]">Style</span>
            <StylePicker value={cardStyle} color={color} onChange={setCardStyle} />
          </div>
        </div>

        <div className="space-y-2">
          <span className={sectionHeader}>Visibility</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
        </div>
      </div>
    </Disclosure>
  );
}
