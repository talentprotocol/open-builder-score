import { Attribution } from 'ox/erc8021'

// Talent Protocol's base.dev Builder Code. Rides every transaction this app
// sends as an ERC-8021 attribution suffix: contracts ignore trailing
// calldata, so the bytes cannot change what the call does — Base's offchain
// indexers read them to credit the activity to us.
export const BUILDER_CODE = 'bc_8bn5tj3m'

export const BUILDER_CODE_DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
