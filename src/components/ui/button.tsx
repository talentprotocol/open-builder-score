import type { ButtonHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-base font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50'

const variants = {
  primary: 'border-transparent bg-foreground text-background hover:bg-foreground/90',
  secondary: 'border-border bg-accent/40 hover:bg-accent hover:border-foreground/20',
  ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground',
  'success-secondary':
    'border-success/30 bg-success/10 text-success hover:bg-success/20 hover:border-success/50',
} as const

const sizes = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3',
  icon: 'size-9',
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({
  variant = 'primary',
  size = 'default',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
