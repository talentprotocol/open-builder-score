import type { HTMLAttributes } from 'react'

const variants = {
  neutral: 'border-border bg-accent/40 text-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
} as const

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants
  compact?: boolean
}

export function Badge({ variant = 'neutral', compact = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-sm border px-2 py-0.5 ${
        compact ? 'text-xs uppercase tracking-wide' : 'text-base'
      } ${variants[variant]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
