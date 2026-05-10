import { useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { getSecondaryColorInfo, setSecondaryColor } from '@/lib/cardStyle';
import type { Bin, Photo } from '@/types';
import { BinPreviewCard } from './BinPreviewCard';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';
import { StylePicker } from './StylePicker';
import type { useAutoSaveBin } from './useAutoSaveBin';

interface BinDetailAppearanceTabProps {
  bin: Bin;
  autoSave: ReturnType<typeof useAutoSaveBin>;
  photos: Photo[];
}

export function BinDetailAppearanceTab({ bin, autoSave, photos }: BinDetailAppearanceTabProps) {
  const [localIcon, setLocalIcon] = useState(bin.icon);
  const [localColor, setLocalColor] = useState(bin.color);
  const [localCardStyle, setLocalCardStyle] = useState(bin.card_style);

  const prevIcon = useRef(bin.icon);
  const prevColor = useRef(bin.color);
  const prevCardStyle = useRef(bin.card_style);

  if (bin.icon !== prevIcon.current) { prevIcon.current = bin.icon; setLocalIcon(bin.icon); }
  if (bin.color !== prevColor.current) { prevColor.current = bin.color; setLocalColor(bin.color); }
  if (bin.card_style !== prevCardStyle.current) { prevCardStyle.current = bin.card_style; setLocalCardStyle(bin.card_style); }

  const secondaryInfo = getSecondaryColorInfo(localCardStyle);

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8 lg:items-start">
      <div className="space-y-3 lg:sticky lg:top-2">
        <Label>Preview</Label>
        <BinPreviewCard
          name={bin.name}
          color={localColor}
          items={bin.items.map((i) => i.name)}
          tags={bin.tags}
          icon={localIcon}
          cardStyle={localCardStyle}
          areaName={bin.area_name}
          fixedSize
        />
      </div>
      <div className="space-y-5 min-w-0">
        <div className="space-y-2">
          <Label>Icon</Label>
          <IconPicker
            value={localIcon}
            onChange={(icon) => {
              setLocalIcon(icon);
              autoSave.saveIcon(icon);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <ColorPicker
            value={localColor}
            onChange={(color) => {
              setLocalColor(color);
              autoSave.saveColor(color);
            }}
            secondaryLabel={secondaryInfo?.label}
            secondaryValue={secondaryInfo?.value}
            onSecondaryChange={
              secondaryInfo
                ? (c) => {
                    const newStyle = setSecondaryColor(localCardStyle, c);
                    setLocalCardStyle(newStyle);
                    autoSave.saveCardStyle(newStyle);
                  }
                : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Style</Label>
          <StylePicker
            value={localCardStyle}
            color={localColor}
            onChange={(style) => {
              setLocalCardStyle(style);
              autoSave.saveCardStyle(style);
            }}
            photos={photos}
          />
        </div>
      </div>
    </div>
  );
}
