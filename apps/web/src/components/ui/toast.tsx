'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; text: string }

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              t.tone === 'success' && 'bg-primary text-primary-foreground',
              t.tone === 'error' && 'bg-accent text-accent-foreground',
              t.tone === 'info' && 'bg-foreground text-background',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
