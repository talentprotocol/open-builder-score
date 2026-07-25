import Link from 'next/link'
import specJson from '../../spec/spec.json'
import { ATTEST_CHAIN_ID, ATTEST_SCHEMA_UID } from '@/lib/eas'
import { verifyPath } from '@/lib/routes'
import type { Spec } from '@/lib/types'

const spec = specJson as Spec

const SCHEMA_URL =
  ATTEST_CHAIN_ID === 84532
    ? `https://base-sepolia.easscan.org/schema/view/${ATTEST_SCHEMA_UID}`
    : `https://base.easscan.org/schema/view/${ATTEST_SCHEMA_UID}`

export function Footer() {
  return (
    <footer className="border-t border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p>Computed entirely in your browser from public data. No backend.</p>
        <p>
          spec v{spec.version} ·{' '}
          <Link href={verifyPath()} className="underline">
            Verify
          </Link>{' '}
          ·{' '}
          <a href={SCHEMA_URL} target="_blank" rel="noreferrer" className="underline">
            EAS schema
          </a>
        </p>
      </div>
    </footer>
  )
}
