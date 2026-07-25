// WalletConnect Cloud project id. This is a PUBLIC client identifier (it ships
// in the browser bundle by design) — hardcoding it does not violate the
// zero-secrets ground rule. Injected wallets (MetaMask etc.) work even with
// this placeholder; WalletConnect QR pairing needs the real id.
// HUMAN ACTION: create a free project at https://cloud.reown.com and replace.
export const WALLETCONNECT_PROJECT_ID = '6a978f82bc5ebbc3c9a9065c47c502a9'
