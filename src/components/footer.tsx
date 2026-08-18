import Link from 'next/link'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr'
import { ATTEST_SCHEMA_UID, EASSCAN_SITE } from '@/lib/eas'
import { attestationsPath, badgesPath, credentialsPath, privacyPath, termsPath, verifyPath } from '@/lib/routes'
import { TalentWordmark } from '@/components/brand/talent-wordmark'
import { ThemeToggle } from '@/components/theme-toggle'

const SCHEMA_URL = `${EASSCAN_SITE}/schema/view/${ATTEST_SCHEMA_UID}`

const productLinkClass =
  'text-sm opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100'

const externalLinkClass =
  'text-sm opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100'

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">
            An open score anyone can recompute from public data.
          </p>
        </div>

        <div className="border-t border-border" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav
            aria-label="Site"
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <Link href={credentialsPath()} className={productLinkClass}>
              Credentials
            </Link>
            <Link href={badgesPath()} className={productLinkClass}>
              Badges
            </Link>
            <Link href={verifyPath()} className={productLinkClass}>
              Verify
            </Link>
            <Link href={attestationsPath()} className={productLinkClass}>
              Attestations
            </Link>
            <Link href={termsPath()} className={externalLinkClass}>
              Terms
            </Link>
            <Link href={privacyPath()} className={externalLinkClass}>
              Privacy
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={SCHEMA_URL}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-1 ${externalLinkClass}`}
            >
              EAS schema <ArrowUpRightIcon className="size-3" />
            </a>
            <a
              href="https://www.talentprotocol.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Talent Protocol"
              className={externalLinkClass}
            >
              <TalentWordmark className="h-4 w-auto" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
