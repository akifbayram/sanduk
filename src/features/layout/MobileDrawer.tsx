import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useOverlayAnimation } from '@/lib/useOverlayAnimation';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileDrawer({ open, onClose, children }: MobileDrawerProps) {
  const { t } = useTranslation('common');
  const panelRef = useRef<HTMLDivElement>(null);
  const { visible, isEntered } = useOverlayAnimation({ open, onClose });
  useFocusTrap({ active: open && visible, containerRef: panelRef });

  if (!visible) return null;

  const duration = '200ms';

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay dismisses drawer on click */}
      <div
        role="presentation"
        className="fixed inset-0 bg-[var(--overlay-backdrop)]"
        style={{
          opacity: isEntered ? 1 : 0,
          transition: `opacity ${duration} ease`,
        }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.navigation', { defaultValue: 'Navigation' })}
        className="fixed top-0 left-0 h-dvh w-[260px] bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col overflow-y-auto pt-[var(--safe-top)]"
        style={{
          transform: isEntered ? 'translateX(0)' : 'translateX(-100%)',
          transition: `transform ${duration} cubic-bezier(0.2, 0.9, 0.3, 1)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
