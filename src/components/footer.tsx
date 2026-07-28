import Link from 'next/link'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr'
import { ATTEST_SCHEMA_UID, EASSCAN_SITE } from '@/lib/eas'
import { verifyPath } from '@/lib/routes'
import { TalentWordmark } from '@/components/brand/talent-wordmark'
import { ThemeToggle } from '@/components/theme-toggle'

const SCHEMA_URL = `${EASSCAN_SITE}/schema/view/${ATTEST_SCHEMA_UID}`

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">
            An open score anyone can recompute from public data.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={verifyPath()}
            className="text-base opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            Verify
          </Link>
          <a
            href={SCHEMA_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-base opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            EAS schema <ArrowUpRightIcon className="size-3" />
          </a>
          <a
            href="https://www.talentprotocol.com"
            target="_blank"
            rel="noreferrer"
            aria-label="Talent Protocol"
            className="opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <TalentWordmark className="h-4 w-auto" />
          </a>
        </div>
      </div>
    </footer>
  )
}
