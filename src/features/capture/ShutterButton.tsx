import { cn, focusRing } from '@/lib/utils';

interface ShutterButtonProps {
  onClick: () => void;
  /** Pulses an accent ring around the shutter when no photos have been taken yet in the relevant scope. */
  showAccentRing: boolean;
  /** Optional `data-tour` attribute hook for the product tour overlay. */
  dataTour?: string;
}

export function ShutterButton({ onClick, showAccentRing, dataTour }: ShutterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={dataTour}
      aria-label="Take photo"
      className={cn(
        focusRing,
        'h-[54px] w-[54px] rounded-[50%] border-[3px] border-white flex items-center justify-center active:scale-95 transition-transform relative focus-visible:ring-offset-2 focus-visible:ring-offset-black',
      )}
    >
      <div className="h-[42px] w-[42px] rounded-[50%] bg-white" />
      {showAccentRing && (
        <div
          aria-hidden="true"
          className="absolute -inset-1 rounded-[50%] ring-[3px] ring-[var(--accent)]"
        />
      )}
    </button>
  );
}
