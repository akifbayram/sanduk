import type { ReactNode } from 'react';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AreaPicker } from '@/features/areas/AreaPicker';
import { AiBadge } from '@/features/bins/AiBadge';
import { ColorPicker } from '@/features/bins/ColorPicker';
import { IconPicker } from '@/features/bins/IconPicker';
import { ItemList } from '@/features/bins/ItemList';
import { QuickAddWidget } from '@/features/bins/QuickAddWidget';
import { TagInput } from '@/features/bins/TagInput';
import type { AiFillField, useAiFillState } from '@/features/bins/useAiFillState';
import type { useItemEntry } from '@/features/bins/useItemEntry';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';
import type { BulkAddAction, Group } from './useBulkGroupAdd';

type ItemEntry = ReturnType<typeof useItemEntry>;

interface GroupReviewFormProps {
  group: Group;
  dispatch: React.Dispatch<BulkAddAction>;
  aiFill: ReturnType<typeof useAiFillState>;
  onUndoAiField: (field: AiFillField) => void;
  allTags: string[];
  locationId: string | null;
  reviewQuickAdd: ItemEntry['quickAdd'];
  reviewDictation: ItemEntry['dictation'];
  canTranscribe: ItemEntry['canTranscribe'];
  aiEnabled: boolean;
  /** Slot rendered between the name field and the items list — typically AI correction widget, error banner, and AI setup affordance. */
  afterName?: ReactNode;
}

/** Field-rendering body of the review step: name, items, area, and the more-options disclosure (notes/tags/icon/color). */
export function GroupReviewForm({
  group,
  dispatch,
  aiFill,
  onUndoAiField,
  allTags,
  locationId,
  reviewQuickAdd,
  reviewDictation,
  canTranscribe,
  aiEnabled,
  afterName,
}: GroupReviewFormProps) {
  const t = useTerminology();
  const nameFilled = aiFill.filled.has('name');
  const itemsFilled = aiFill.filled.has('items');

  return (
    <>
      <div
        key={aiFill.keyFor('name')}
        className={cn('space-y-2', nameFilled && 'ai-field-fill')}
        style={aiFill.styleFor('name', 0)}
      >
        <div className="flex items-center justify-between">
          <Label htmlFor={`name-${group.id}`}>Name</Label>
          {nameFilled && <AiBadge onUndo={() => onUndoAiField('name')} />}
        </div>
        <Input
          id={`name-${group.id}`}
          value={group.name}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { name: e.target.value } })
          }
          placeholder="e.g., Holiday Decorations"
          className="font-medium"
        />
      </div>

      {afterName}

      <div
        key={aiFill.keyFor('items')}
        className={cn('space-y-2', itemsFilled && 'ai-field-fill')}
        style={aiFill.styleFor('items', 1)}
      >
        <ItemList
          items={group.items}
          onItemsChange={(items) =>
            dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { items } })
          }
          headerExtra={itemsFilled ? <AiBadge onUndo={() => onUndoAiField('items')} /> : undefined}
          footerSlot={
            <QuickAddWidget
              quickAdd={reviewQuickAdd}
              aiEnabled={aiEnabled}
              dictation={reviewDictation}
              canTranscribe={canTranscribe}
              variant="inline"
              isEmptyList={group.items.length === 0}
            />
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Area</Label>
        <AreaPicker
          locationId={locationId ?? undefined}
          value={group.areaId}
          onChange={(areaId) =>
            dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { areaId } })
          }
        />
      </div>

      <Disclosure
        label="More options"
        labelClassName="py-2 text-[var(--accent)] cursor-pointer"
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`notes-${group.id}`}>Notes</Label>
            <Textarea
              id={`notes-${group.id}`}
              value={group.notes}
              onChange={(e) =>
                dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { notes: e.target.value } })
              }
              placeholder={`Notes about this ${t.bin}...`}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput
              tags={group.tags}
              onChange={(tags) =>
                dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { tags } })
              }
              suggestions={allTags}
            />
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <IconPicker
              value={group.icon}
              onChange={(icon) =>
                dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { icon } })
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPicker
              value={group.color}
              onChange={(color) =>
                dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { color } })
              }
            />
          </div>
        </div>
      </Disclosure>
    </>
  );
}
