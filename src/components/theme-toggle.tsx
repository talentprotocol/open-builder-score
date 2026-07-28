'use client'

import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react/dist/ssr'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { useMounted } from '@/components/use-mounted'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()

  // Cycle dark -> light -> system; icon previews the next stop.
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
  const Icon = !mounted
    ? MoonIcon
    : theme === 'dark'
      ? SunIcon
      : theme === 'light'
        ? MonitorIcon
        : MoonIcon

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground"
      aria-label="Toggle theme"
      onClick={() => {
        if (mounted) setTheme(next)
      }}
    >
      <Icon className="size-5" />
    </Button>
  )
}
