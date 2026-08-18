import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startRedirectCountdown } from '@/app/data-opt-out/confirm/[token]/page'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startRedirectCountdown', () => {
  it('ticks once per second down to 1, then redirects instead of ticking to 0', () => {
    const ticks: number[] = []
    let redirected = false

    startRedirectCountdown(
      10,
      (remaining) => ticks.push(remaining),
      () => {
        redirected = true
      },
    )

    vi.advanceTimersByTime(9_000)
    expect(ticks).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(redirected).toBe(false)

    vi.advanceTimersByTime(1_000)
    expect(redirected).toBe(true)
    // onTick is never called with 0 — the caller redirects instead of
    // rendering a "0s" flash.
    expect(ticks).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('redirects exactly once even if time keeps advancing', () => {
    let redirectCount = 0

    startRedirectCountdown(
      3,
      () => {},
      () => {
        redirectCount += 1
      },
    )

    vi.advanceTimersByTime(10_000)
    expect(redirectCount).toBe(1)
  })

  it('stops ticking and never redirects once the returned stop function is called', () => {
    const ticks: number[] = []
    let redirected = false

    const stop = startRedirectCountdown(
      5,
      (remaining) => ticks.push(remaining),
      () => {
        redirected = true
      },
    )

    vi.advanceTimersByTime(2_000)
    expect(ticks).toEqual([4, 3])

    stop()

    vi.advanceTimersByTime(10_000)
    expect(ticks).toEqual([4, 3])
    expect(redirected).toBe(false)
  })

  it('supports a short countdown (1 second) redirecting on the very first tick', () => {
    let redirected = false

    startRedirectCountdown(
      1,
      () => {},
      () => {
        redirected = true
      },
    )

    vi.advanceTimersByTime(999)
    expect(redirected).toBe(false)

    vi.advanceTimersByTime(1)
    expect(redirected).toBe(true)
  })
})
