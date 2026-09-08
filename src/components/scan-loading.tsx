import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'

// Shared first-paint shell for the client-only scan/verify screens. Kept
// tiny on purpose: the real pages pull the scoring stack, and that must
// never run during SSR — Vercel Fluid bills Active CPU for it.
export function ScanLoading({ label }: { label: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <div className="blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6">
        <SweepOverlay />
        <p className="flex items-center gap-2.5 text-base text-muted-foreground">
          <PingDot settled={false} /> {label}
        </p>
      </div>
    </main>
  )
}
