import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function AppDialog({ title, children, onClose, wide = false, fullScreen = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; fullScreen?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const keepFocusInDialog = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.target instanceof Element && event.target.closest('dialog') !== event.currentTarget) return;
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]'))
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled, [hidden], input[type="hidden"]') && control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); heading.current?.focus(); return; }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      event.preventDefault();
      last.focus();
    }
  };

  return <dialog ref={dialog} className={`nav-app-dialog${wide ? ' nav-app-dialog-wide' : ''}${fullScreen ? ' nav-app-dialog-fullscreen' : ''}`} aria-labelledby={titleId}
    onKeyDown={keepFocusInDialog} onCancel={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <header className="nav-dialog-heading">
      <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
      <button type="button" className="nav-icon-button" aria-label="Fermer la fenêtre" onClick={onClose}><X size={20} /></button>
    </header>
    {children}
  </dialog>;
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, danger = false }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; danger?: boolean;
}) {
  return <AppDialog title={title} onClose={onClose}>
    <div className="nav-dialog-copy">{children}</div>
    <div className="nav-dialog-actions">
      <button type="button" className="nav-secondary-button" onClick={onClose}>Annuler</button>
      <button type="button" className={danger ? 'nav-danger-button' : 'nav-primary-button'} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </AppDialog>;
}
