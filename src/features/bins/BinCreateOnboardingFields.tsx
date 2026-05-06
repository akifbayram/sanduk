import { Input } from '@/components/ui/input';
import { AreaPicker } from '@/features/areas/AreaPicker';
import { getSecondaryColorInfo, setSecondaryColor } from '@/lib/cardStyle';
import { useTerminology } from '@/lib/terminology';
import type { useDictation } from '@/lib/useDictation';
import type { BinItem } from '@/types';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';
import { ItemList } from './ItemList';
import { PhotoUploadSection } from './PhotoUploadSection';
import { QuickAddWidget } from './QuickAddWidget';
import { StylePicker } from './StylePicker';
import type { useQuickAdd } from './useQuickAdd';

interface BinCreateOnboardingFieldsProps {
  locationId: string;
  /** Form field state */
  name: string;
  setName: (name: string) => void;
  items: BinItem[];
  setItems: (items: BinItem[]) => void;
  areaId: string | null;
  setAreaId: (id: string | null) => void;
  icon: string;
  setIcon: (icon: string) => void;
  color: string;
  setColor: (color: string) => void;
  cardStyle: string;
  setCardStyle: (style: string) => void;
  /** Photo upload — same shape as `PhotoUploadSection`'s props. */
  photoUpload: React.ComponentProps<typeof PhotoUploadSection>;
  /** Item entry (QuickAdd + dictation) */
  quickAdd: ReturnType<typeof useQuickAdd>;
  dictation: ReturnType<typeof useDictation>;
  canTranscribe: boolean;
  /** Whether the AI affordance should show (AI globally enabled). */
  showAi: boolean;
}

const compactLabel = 'text-[13px] text-[var(--text-tertiary)] mb-1.5 block';

/**
 * Onboarding-mode bin form layout: name, items, area, photo upload,
 * and inline appearance pickers. No AI fill button — onboarding analyzes
 * via the photo upload section directly.
 */
export function BinCreateOnboardingFields({
  locationId,
  name,
  setName,
  items,
  setItems,
  areaId,
  setAreaId,
  icon,
  setIcon,
  color,
  setColor,
  cardStyle,
  setCardStyle,
  photoUpload,
  quickAdd,
  dictation,
  canTranscribe,
  showAi,
}: BinCreateOnboardingFieldsProps) {
  const t = useTerminology();
  const secondaryInfo = getSecondaryColorInfo(cardStyle);

  return (
    <>
      <div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${t.Bin} name`}
          maxLength={255}
          required
          autoFocus
        />
      </div>

      <div className="text-left">
        <ItemList
          items={items}
          onItemsChange={setItems}
          footerSlot={
            <QuickAddWidget
              quickAdd={quickAdd}
              aiEnabled={showAi}
              dictation={dictation}
              canTranscribe={canTranscribe}
              variant="inline"
              isEmptyList={items.length === 0}
            />
          }
        />
      </div>

      <div className="text-left">
        <label htmlFor="bin-area" className={compactLabel}>{t.Area}</label>
        <AreaPicker locationId={locationId} value={areaId} onChange={setAreaId} />
      </div>

      <PhotoUploadSection {...photoUpload} />

      <div className="text-left">
        <label htmlFor="bin-color" className={compactLabel}>Color</label>
        <ColorPicker
          value={color}
          onChange={setColor}
          secondaryLabel={secondaryInfo?.label}
          secondaryValue={secondaryInfo?.value}
          onSecondaryChange={secondaryInfo ? (c) => setCardStyle(setSecondaryColor(cardStyle, c)) : undefined}
        />
      </div>
      <div className="text-left">
        <label htmlFor="bin-icon" className={compactLabel}>Icon</label>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <div className="text-left">
        <label htmlFor="bin-style" className={compactLabel}>Style</label>
        <StylePicker value={cardStyle} color={color} onChange={setCardStyle} />
      </div>
    </>
  );
}
