'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/** Native <dialog> modal: focus trap, Esc to close and backdrop come from the browser. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="dialog-title" className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Đóng">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
