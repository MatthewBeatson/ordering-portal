import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'accent' | 'success' | 'danger' | 'muted' | 'warning' | 'purple' | 'teal';

const toneClasses: Record<Tone, string> = {
  default: 'bg-[var(--muted)] text-[var(--foreground)]',
  accent: 'bg-[var(--accent-muted)] text-[var(--accent)]',
  success: 'bg-[var(--success-muted)] text-[var(--success)]',
  danger: 'bg-[var(--danger-muted)] text-[var(--danger)]',
  muted: 'bg-transparent text-[var(--muted-foreground)] border border-[var(--border-strong)]',
  warning: 'bg-[var(--warning-muted)] text-[var(--warning)]',
  purple: 'bg-[var(--purple-muted)] text-[var(--purple)]',
  teal: 'bg-[var(--teal-muted)] text-[var(--teal)]',
};

export function Badge({ tone = 'default', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', toneClasses[tone], className)}
      {...props}
    />
  );
}
