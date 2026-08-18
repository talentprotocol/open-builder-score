// Raw wallet/RPC errors never reach the UI as a headline. A user rejection is
// not an error at all — it is a decision, rendered neutrally with the action
// left ready to retry. Everything else gets a human sentence, with the raw
// message preserved as collapsible detail for debugging.

export type WalletAction = 'connect' | 'switch' | 'sign' | 'attest'

export interface WalletErrorInfo {
  message: string
  detail: string | null
  cancelled: boolean
}

const FAILURE_MESSAGE: Record<WalletAction, string> = {
  connect: "Couldn't open the wallet connection — try again.",
  switch: "Couldn't switch to Base — switch manually in your wallet and try again.",
  sign: "Couldn't get a signature from the wallet — try again.",
  attest: 'The attestation failed onchain. Nothing was spent besides gas. Try again.',
}

// EIP-1193 code 4001 / viem's UserRejectedRequestError, possibly buried in a
// cause chain (wagmi wraps provider errors). Hop cap guards cyclic causes.
function isUserRejection(e: unknown): boolean {
  let current: unknown = e
  for (let hops = 0; hops < 10 && current && typeof current === 'object'; hops++) {
    const { code, name, cause } = current as { code?: unknown; name?: unknown; cause?: unknown }
    if (code === 4001 || name === 'UserRejectedRequestError') return true
    if (cause === current) break
    current = cause
  }
  return false
}

export function describeWalletError(e: unknown, action: WalletAction): WalletErrorInfo {
  if (isUserRejection(e)) {
    return { message: 'Cancelled in the wallet.', detail: null, cancelled: true }
  }
  return {
    message: FAILURE_MESSAGE[action],
    detail: e instanceof Error ? e.message : null,
    cancelled: false,
  }
}
