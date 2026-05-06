import { useSearchParams } from 'react-router-dom';
import { CapturePageBulkGroup } from './CapturePageBulkGroup';
import { CaptureSingleBinPage } from './CaptureSingleBinPage';

export function CapturePage() {
  const [searchParams] = useSearchParams();
  const binId = searchParams.get('binId') ?? undefined;

  if (!binId) return <CapturePageBulkGroup />;
  return <CaptureSingleBinPage binId={binId} />;
}
