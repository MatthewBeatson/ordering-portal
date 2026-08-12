import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-sm placeholder:text-[var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
