import './print.css';
import { List, Tag, Type } from 'lucide-react';
import { useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { TourLauncher } from '@/features/tour/TourLauncher';
import { useUserPreferences } from '@/lib/userPreferences';
import { BinSelectorCard } from './BinSelectorCard';
import { ItemListOptionsCard } from './ItemListOptionsCard';
import { ItemSheet } from './ItemSheet';
import { LabelFormatCard } from './LabelFormatCard';
import { LabelOptionsCard } from './LabelOptionsCard';
import { LabelSheet } from './LabelSheet';
import { NameCardOptionsCard } from './NameCardOptionsCard';
import { NameSheet } from './NameSheet';
import { PreviewPanel } from './PreviewPanel';
import { QrStyleCard } from './QrStyleCard';
import { usePrintPageActions } from './usePrintPageActions';

export function PrintPage() {
  const {
    allBins, areas, isLoading,
    selection,
    format,
    labelOptions, handleUpdateLabelOption,
    qrStyle, handleUpdateQrStyle,
    printMode, handlePrintModeChange,
    itemListOptions, handleUpdateItemListOption,
    itemSheetProps,
    nameCardOptions, handleUpdateNameCardOption,
    copies,
    updateCopies,
    expandedBins,
    expandedBinCount,
    nameSheetProps,
    ui,
    pdfLoading, handleDownloadPDF,
    labelSheetProps,
  } = usePrintPageActions();

  const { preferences, isLoading: prefsLoading, updatePreferences } = useUserPreferences();
  useEffect(() => {
    if (prefsLoading) return;
    if (preferences.print_visited_at) return;
    updatePreferences({ print_visited_at: new Date().toISOString() });
  }, [prefsLoading, preferences.print_visited_at, updatePreferences]);

  if (isLoading) {
    return (
      <div className="page-content print-hide max-w-6xl">
        {/* PageHeader */}
        <div className="flex items-center gap-2">
          <Skeleton className="hidden lg:block h-8 w-8 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-8 w-14" />
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-4">
          <div className="flex flex-col gap-4">
            {/* OptionGroup — 3 segments */}
            <div className="flex bg-[var(--bg-flat)] border border-[var(--border-flat)] rounded-[var(--radius-md)] p-1 gap-0.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5">
                  <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
                  <Skeleton className="h-3.5 w-12" />
                </div>
              ))}
            </div>

            {/* Collapsed cards */}
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent>
                  <div className="row-spread">
                    <div className="row">
                      <Skeleton className="h-4 w-4 rounded shrink-0" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                    <Skeleton className="h-5 w-5 rounded shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Preview column */}
          <div className="lg:sticky lg:top-6 flex flex-col gap-4">
            <div className="flex gap-2">
              <Skeleton className="flex-1 h-12 rounded-[var(--radius-md)]" />
              <Skeleton className="h-12 w-[72px] rounded-[var(--radius-md)]" />
            </div>
            <Card className="hidden lg:block">
              <CardContent>
                <Skeleton className="h-4 w-16 mb-3" />
                <Skeleton className="h-48 w-full rounded-[var(--radius-md)]" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-content print-hide max-w-6xl">
        <PageHeader title="Print" back actions={<TourLauncher tourId="print-scan" />} />

        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-4">
        {/* Left column — settings */}
        <div className="flex flex-col gap-4">
          <div data-tour="print-mode">
            <OptionGroup
              options={[
                { key: 'labels', label: 'Labels', icon: Tag },
                { key: 'names', label: 'Names', icon: Type },
                { key: 'items', label: 'Item List', icon: List },
              ]}
              value={printMode}
              onChange={handlePrintModeChange}
            />
          </div>

          <div data-tour="print-bin-selector">
            <BinSelectorCard
              allBins={allBins}
              areas={areas}
              selectedIds={selection.selectedIds}
              toggleBin={selection.toggleBin}
              selectAll={selection.selectAll}
              selectNone={selection.selectNone}
              toggleArea={selection.toggleArea}
              expanded={ui.binsExpanded}
              onExpandedChange={ui.setBinsExpanded}
            />
          </div>

          {(printMode === 'labels' || printMode === 'names') && (
            <LabelFormatCard
              format={format}
              expanded={ui.formatExpanded}
              onExpandedChange={ui.setFormatExpanded}
            />
          )}

          {printMode === 'labels' && (
            <LabelOptionsCard
              labelOptions={labelOptions}
              onUpdateOption={handleUpdateLabelOption}
              copies={copies}
              onUpdateCopies={updateCopies}
              expanded={ui.optionsExpanded}
              onExpandedChange={ui.setOptionsExpanded}
            />
          )}

          {printMode === 'names' && (
            <NameCardOptionsCard
              options={nameCardOptions}
              onUpdate={handleUpdateNameCardOption}
              copies={copies}
              onUpdateCopies={updateCopies}
              expanded={ui.nameCardOptionsExpanded}
              onExpandedChange={ui.setNameCardOptionsExpanded}
            />
          )}

          {printMode === 'items' && (
            <ItemListOptionsCard
              options={itemListOptions}
              onUpdate={handleUpdateItemListOption}
              expanded={ui.itemListOptionsExpanded}
              onExpandedChange={ui.setItemListOptionsExpanded}
            />
          )}

          {(printMode === 'labels' || printMode === 'items') && (
            <QrStyleCard
              qrStyle={qrStyle}
              onUpdateStyle={handleUpdateQrStyle}
              expanded={ui.qrStyleExpanded}
              onExpandedChange={ui.setQrStyleExpanded}
            />
          )}
        </div>

        {/* Right column — preview (sticky on desktop) */}
        <div className="lg:sticky lg:top-6 flex flex-col gap-4">
          <PreviewPanel
            selectedBins={selection.selectedBins}
            expandedBins={expandedBins}
            expandedBinCount={expandedBinCount}
            pdfLoading={pdfLoading}
            onDownloadPDF={handleDownloadPDF}
            labelSheetProps={labelSheetProps}
            printMode={printMode}
            itemSheetProps={itemSheetProps}
            nameSheetProps={nameSheetProps}
          />
        </div>
        </div>
      </div>

      <div className="print-show">
        {printMode === 'items' ? (
          <ItemSheet {...itemSheetProps} />
        ) : printMode === 'names' ? (
          <NameSheet {...nameSheetProps} />
        ) : (
          <LabelSheet {...labelSheetProps} />
        )}
      </div>
    </>
  );
}
