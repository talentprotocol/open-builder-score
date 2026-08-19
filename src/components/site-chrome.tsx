'use client'

import { usePathname } from 'next/navigation'
import { AcquisitionBanner } from '@/components/acquisition-banner'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { TalentWordmark } from '@/components/brand/talent-wordmark'

// The data-transfer opt-out flow (`/data-opt-out` and its
// `confirm/[token]` subtree) is a legal consent flow a recipient reaches
// from an email, not from browsing the app. The Builder Score
// navbar/footer there would show an unfamiliar product brand plus links
// inviting the recipient away from the decision — exactly the shape people
// are trained to read as phishing. So these two routes render a bare shell
// with a Talent Protocol wordmark (matching the email's branding) instead
// of the app chrome. Every other route is unaffected.
//
// A nested layout can't remove markup the root layout renders around
// `children`, and giving these routes their own root layout would mean
// dropping `app/layout.tsx` entirely — for two routes, that's the more
// invasive option. Gating here, on pathname, keeps the app to one root
// layout and keeps this decision in a single obvious place.
const BARE_CHROME_ROUTE = '/data-opt-out'

function isBareChromeRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return pathname === BARE_CHROME_ROUTE || pathname.startsWith(`${BARE_CHROME_ROUTE}/`)
}

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (isBareChromeRoute(pathname)) {
    return (
      <div className="flex min-h-dvh flex-1 flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8">
          <TalentWordmark className="h-6 w-auto" />
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <Header />
      <AcquisitionBanner />
      {children}
      <Footer />
    </div>
  )
}
