// WalletConnect Cloud project id. This is a PUBLIC client identifier (it ships
// in the browser bundle by design) — hardcoding it does not violate the
// zero-secrets ground rule. Injected wallets (MetaMask etc.) work even with
// this placeholder; WalletConnect QR pairing needs the real id.
// HUMAN ACTION: create a free project at https://cloud.reown.com and replace.
export const WALLETCONNECT_PROJECT_ID = '6a978f82bc5ebbc3c9a9065c47c502a9'
import { useSyncExternalStore } from 'react'

// True when wagmi's persisted store holds a live connection — the signal the
// wallet islands use to mount eagerly (restoring the connected chip) instead
// of waiting for a click. Storage shape is wagmi's own; read defensively and
// treat anything malformed as "no session".
export function hasWalletSession(): boolean {
  try {
    const raw = window.localStorage.getItem('wagmi.store')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { state?: { current?: string | null } }
    return Boolean(parsed.state?.current)
  } catch {
    return false
  }
}

// False on the server and through hydration, then whether a persisted wagmi
// session exists. An external read wants useSyncExternalStore, not
// setState-in-effect; the store is read once per render and never notifies.
const subscribeNever = () => () => {}
export function useHasWalletSession(): boolean {
  return useSyncExternalStore(subscribeNever, hasWalletSession, () => false)
}
