import { useLayoutEffect, useRef } from 'react';

/** Native dialog supplies focus containment and Escape; cleanup restores the opener's focus. */
export function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.isConnected) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !dialog.contains(active) ? active : null;

    // A close event queued before a StrictMode remount must not close the reopened dialog.
    const handleClose = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('close', handleClose);
    if (!dialog.open) dialog.showModal();
    initialFocusRef.current?.focus();

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return { dialogRef, initialFocusRef };
}

export const MODAL_DIALOG_CLASS =
  'fixed inset-0 m-0 h-full max-h-none w-full max-w-none open:flex items-center justify-center p-3 sm:p-6 bg-transparent text-zinc-100 overflow-y-auto backdrop:bg-black/85 backdrop:backdrop-blur-sm';
