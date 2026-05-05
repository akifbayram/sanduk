import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AiConfiguredIndicator, InlineAiSetup } from '@/features/ai/InlineAiSetup';
import { useAiProviderSetup } from '@/features/ai/useAiProviderSetup';
import { useAiSettings } from '@/features/ai/useAiSettings';
import { useAreaList } from '@/features/areas/useAreas';
import { setCapturedReturnTarget } from '@/features/capture/capturedPhotos';
import { useAiEnabled } from '@/lib/aiToggle';
import { aiItemsToBinItems, binItemsToPayload } from '@/lib/itemQuantities';
import { useTerminology } from '@/lib/terminology';
import { cn, sectionHeader, stickyDialogFooter } from '@/lib/utils';
import type { BinItem, BinVisibility } from '@/types';
import { AiBadge } from './AiBadge';
import { BinAiFillSection } from './BinAiFillSection';
import { BinAiSetupPanel } from './BinAiSetupPanel';
import { BinCreateOnboardingFields } from './BinCreateOnboardingFields';
import { BinMoreOptionsSection } from './BinMoreOptionsSection';
import { ItemList } from './ItemList';
import { PhotoBulkAdd } from './PhotoBulkAdd';
import { PhotoUploadSection } from './PhotoUploadSection';
import { QuickAddWidget } from './QuickAddWidget';
import { type AiFillField, useAiFillState } from './useAiFillState';
import { useBinCreateWizard } from './useBinCreateWizard';
import { useBinFormFields } from './useBinFormFields';
import { useCustomFields } from './useCustomFields';
import { useDeferredAiFill } from './useDeferredAiFill';
import { useItemEntry } from './useItemEntry';
import { usePhotoAnalysis } from './usePhotoAnalysis';

export interface BinCreateFormData {
  name: string;
  items: (string | { name: string; quantity?: number | null })[];
  notes: string;
  tags: string[];
  areaId: string | null;
  icon: string;
  color: string;
  cardStyle: string;
  visibility: BinVisibility;
  customFields: Record<string, string>;
  photos: File[];
}

interface BinCreateFormProps {
  mode: 'full' | 'onboarding';
  locationId: string;
  onSubmit: (data: BinCreateFormData) => void | Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
  showCancel?: boolean;
  onCancel?: () => void;
  prefillName?: string;
  allTags?: string[];
  header?: React.ReactNode | ((state: { name: string; color: string; items: BinItem[]; tags: string[]; icon: string; cardStyle: string; areaName: string }) => React.ReactNode);
  className?: string;
  initialPhotos?: File[] | null;
  onInitialPhotosConsumed?: () => void;
  initialGroups?: number[] | null;
  onWizardComplete?: () => void;
  /** When true, programmatically clicks the photo file input once on mount (gallery deep-link). */
  triggerFilePickerOnMount?: boolean;
}

export function BinCreateForm({
  mode,
  locationId,
  onSubmit,
  submitting,
  submitLabel,
  showCancel,
  onCancel,
  prefillName,
  allTags,
  header,
  className,
  initialPhotos,
  onInitialPhotosConsumed,
  initialGroups,
  onWizardComplete,
  triggerFilePickerOnMount,
}: BinCreateFormProps) {
  const t = useTerminology();
  const { areas } = useAreaList(locationId);
  const { settings: aiSettings, isLoading: aiSettingsLoading } = useAiSettings();
  const { aiEnabled } = useAiEnabled();

  const navigate = useNavigate();
  const location = useLocation();

  function handleCameraClick() {
    setCapturedReturnTarget('bin-create');
    navigate('/capture', { state: { returnTo: location.pathname } });
  }

  const {
    name, setName,
    areaId, setAreaId,
    items, setItems,
    notes, setNotes,
    tags, setTags,
    icon, setIcon,
    color, setColor,
    cardStyle, setCardStyle,
    visibility, setVisibility,
    customFields, setCustomFields,
  } = useBinFormFields({ initialName: prefillName });

  const { fields: customFieldDefs } = useCustomFields(locationId);

  const aiFill = useAiFillState();

  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Onboarding-specific: inline AI setup
  const [aiExpanded, setAiExpanded] = useState(false);
  const setup = useAiProviderSetup({ onSaveSuccess: () => setAiExpanded(false) });
  const aiConfiguredInline = setup.configured || (aiSettings !== null && !aiSettingsLoading);

  // Full-mode: inline AI setup
  const [showAiSetup, setShowAiSetup] = useState(false);
  const fullSetup = useAiProviderSetup({ onSaveSuccess: () => setShowAiSetup(false) });

  const isFull = mode === 'full';
  const aiReady = isFull ? (aiEnabled && !!aiSettings) : aiConfiguredInline;
  const showAi = isFull ? aiEnabled : true;

  const handleAiSetupNeeded = () => {
    if (isFull) {
      setShowAiSetup(true);
    } else {
      setAiExpanded(true);
    }
  };

  const deferredAiFill = useDeferredAiFill({
    onApply: (result) => {
      const filled = new Set<AiFillField>();
      if (result.name) {
        setName(result.name);
        filled.add('name');
      }
      if (result.items?.length) {
        setItems(aiItemsToBinItems(result.items));
        filled.add('items');
      }
      aiFill.markFilled(filled);
    },
  });

  const {
    fileInputRef,
    photos,
    photoPreviews,
    analyzing,
    analyzeError,
    analyzeMode,
    analyzePartialText,
    cancelAnalyze,
    handlePhotoSelect,
    handleRemovePhoto,
    addPhotosFromFiles,
    clearPhotos,
    handleAnalyze,
    handleReanalyze,
  } = usePhotoAnalysis({
    locationId,
    aiConfigured: isFull ? aiReady : aiConfiguredInline,
    onApplyDirect: (result) => {
      aiFill.snapshot({ name, items });
      deferredAiFill.schedule(result);
    },
    onAiSetupNeeded: handleAiSetupNeeded,
  });

  const wizard = useBinCreateWizard({
    initialPhotos,
    initialGroups,
    formPhotos: photos,
    onCancelAnalyze: cancelAnalyze,
    onClearFormPhotos: clearPhotos,
  });

  // Clear AI success banner when all photos are removed so the user can re-analyze with new photos.
  useEffect(() => {
    if (photos.length === 0) {
      aiFill.reset();
    }
  }, [photos.length, aiFill.reset]);

  const initialPhotosConsumedRef = useRef(false);
  useEffect(() => {
    if (initialPhotosConsumedRef.current) return;
    if (!initialPhotos || initialPhotos.length === 0) return;
    initialPhotosConsumedRef.current = true;
    addPhotosFromFiles(initialPhotos);
    onInitialPhotosConsumed?.();
  }, [initialPhotos, addPhotosFromFiles, onInitialPhotosConsumed]);

  const filePickerTriggeredRef = useRef(false);
  useEffect(() => {
    if (filePickerTriggeredRef.current) return;
    if (!triggerFilePickerOnMount) return;
    filePickerTriggeredRef.current = true;
    fileInputRef.current?.click();
  }, [triggerFilePickerOnMount, fileInputRef]);

  function handleUndoAiField(field: AiFillField) {
    const snap = aiFill.undo(field);
    if (!snap) return;
    if (field === 'name') setName(snap.name);
    else setItems(snap.items);
  }

  const { quickAdd, dictation, canTranscribe } = useItemEntry({
    binName: name,
    existingItems: items.map((i) => i.name),
    locationId: locationId ?? undefined,
    aiReady,
    aiSettings,
    onAdd: (newItems) => setItems([...items, ...newItems]),
    onNavigateAiSetup: handleAiSetupNeeded,
  });

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      items: binItemsToPayload(items),
      notes: notes.trim(),
      tags,
      areaId,
      icon,
      color,
      cardStyle: cardStyle || '',
      visibility,
      customFields,
      photos,
    });
  }

  if (wizard.wizardActive) {
    return (
      <PhotoBulkAdd
        initialPhotos={wizard.effectivePhotos ?? []}
        initialGroups={wizard.effectiveGroups ?? null}
        aiSettings={aiSettings}
        onComplete={() => {
          wizard.exitWizard();
          onInitialPhotosConsumed?.();
          onWizardComplete?.();
        }}
        onExitToForm={() => {
          wizard.exitWizard();
          onInitialPhotosConsumed?.();
        }}
      />
    );
  }

  const areaName = areas.find(a => a.id === areaId)?.name ?? '';
  const renderedHeader = typeof header === 'function'
    ? header({ name, color, items, tags, icon, cardStyle, areaName })
    : header;

  const photoUploadProps = {
    fileInputRef,
    photos,
    photoPreviews,
    onPhotoSelect: handlePhotoSelect,
    onRemovePhoto: handleRemovePhoto,
    onCameraClick: handleCameraClick,
    onFilesDropped: addPhotosFromFiles,
    onMultiFileSelection: wizard.promoteFiles,
    analyzing,
  };

  return (
    <form onSubmit={handleFormSubmit} className={cn(isFull ? 'flex flex-1 flex-col gap-5' : 'space-y-3', className)}>
      {renderedHeader}

      {isFull ? (
        <>
          <PhotoUploadSection {...photoUploadProps} />

          <BinAiFillSection
            analyzing={analyzing}
            analyzeError={analyzeError}
            analyzeMode={analyzeMode}
            analyzePartialText={analyzePartialText}
            confirmPhase={deferredAiFill.confirmPhase}
            cancelAnalyze={cancelAnalyze}
            aiReady={aiReady}
            showAi={showAi}
            photos={photos}
            name={name}
            items={items}
            filledCount={aiFill.filled.size}
            onAnalyze={handleAnalyze}
            onReanalyze={handleReanalyze}
            onConfigureAi={() => setShowAiSetup(true)}
          />

          {showAiSetup && !aiReady && (
            <BinAiSetupPanel setup={fullSetup} onClose={() => setShowAiSetup(false)} />
          )}

          {/* Name with validation and AI badge */}
          <div
            key={aiFill.keyFor('name')}
            className={cn('space-y-2', aiFill.filled.has('name') && 'ai-field-fill')}
            style={aiFill.styleFor('name', 0)}
          >
            <div className="flex items-center justify-between">
              <label htmlFor="bin-name" className={sectionHeader}>Name</label>
              {aiFill.filled.has('name') && <AiBadge onUndo={() => handleUndoAiField('name')} />}
            </div>
            <Input
              id="bin-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(null); }}
              onBlur={() => { if (!name.trim()) setNameError('Name is required'); }}
              placeholder="e.g., Holiday Decorations"
              maxLength={255}
              required
              aria-invalid={!!nameError}
              className={cn(nameError && 'border-[var(--destructive)] focus-visible:ring-[var(--destructive)]')}
            />
            {nameError && (
              <p role="alert" className="text-[12px] text-[var(--destructive)]">
                {nameError}
              </p>
            )}
          </div>

          {/* Items */}
          <div
            key={aiFill.keyFor('items')}
            className={cn('space-y-2', aiFill.filled.has('items') && 'ai-field-fill')}
            style={aiFill.styleFor('items', 1)}
          >
            <ItemList
              items={items}
              onItemsChange={setItems}
              headerExtra={aiFill.filled.has('items') ? <AiBadge onUndo={() => handleUndoAiField('items')} /> : undefined}
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

          <BinMoreOptionsSection
            open={moreOptionsOpen}
            onOpenChange={setMoreOptionsOpen}
            locationId={locationId}
            name={name}
            items={items}
            areaId={areaId}
            setAreaId={setAreaId}
            notes={notes}
            setNotes={setNotes}
            tags={tags}
            setTags={setTags}
            allTags={allTags}
            customFieldDefs={customFieldDefs}
            customFields={customFields}
            setCustomFields={setCustomFields}
            icon={icon}
            setIcon={setIcon}
            color={color}
            setColor={setColor}
            cardStyle={cardStyle}
            setCardStyle={setCardStyle}
            visibility={visibility}
            setVisibility={setVisibility}
            areaName={areaName}
          />
        </>
      ) : (
        <BinCreateOnboardingFields
          locationId={locationId}
          name={name}
          setName={setName}
          items={items}
          setItems={setItems}
          areaId={areaId}
          setAreaId={setAreaId}
          icon={icon}
          setIcon={setIcon}
          color={color}
          setColor={setColor}
          cardStyle={cardStyle}
          setCardStyle={setCardStyle}
          photoUpload={photoUploadProps}
          quickAdd={quickAdd}
          dictation={dictation}
          canTranscribe={canTranscribe}
          showAi={showAi}
        />
      )}

      {/* Inline AI setup (onboarding mode only) */}
      {!isFull && !aiSettingsLoading && (
        <div className="text-left">
          {aiConfiguredInline ? (
            <AiConfiguredIndicator>
              {photos.length > 0 && (
                <span className="text-[var(--text-tertiary)]">— tap <Sparkles className="h-3 w-3 inline" /> to analyze</span>
              )}
            </AiConfiguredIndicator>
          ) : (
            <InlineAiSetup
              expanded={aiExpanded}
              onExpandedChange={setAiExpanded}
              setup={setup}
              label="Set up AI Analysis"
            />
          )}
        </div>
      )}

      {/* Footer */}
      {isFull ? (
        <div className={cn('flex gap-2 justify-end', stickyDialogFooter)}>
          {showCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating...' : (submitLabel ?? 'Create')}
          </Button>
        </div>
      ) : (
        <Button
          type="submit"
          disabled={!name.trim() || submitting}
          className="w-full rounded-[var(--radius-md)] h-11 text-[15px]"
        >
          {submitting ? 'Creating...' : (submitLabel ?? `Create ${t.Bin}`)}
        </Button>
      )}
    </form>
  );
}
