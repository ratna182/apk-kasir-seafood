import { describe, expect, it } from 'vitest'
import { getStoreDateKey, getStoreDayRange } from '../time'

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

describe('getStoreDayRange', () => {
  it('opens the store day at midnight Jakarta, not midnight UTC', () => {
    // 00:13 WIB on 17 Oct is 17:13 UTC on 16 Oct, so a UTC day boundary would call it yesterday.
    const { today, tomorrow } = getStoreDayRange(new Date('2026-10-16T17:13:00.000Z'))

    expect(today.toISOString()).toBe('2026-10-16T17:00:00.000Z')
    expect(tomorrow.toISOString()).toBe('2026-10-17T17:00:00.000Z')
    expect(tomorrow.getTime() - today.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('keeps a late evening sale inside the same store day', () => {
    // 23:55 WIB on 16 Oct is 16:55 UTC on 16 Oct, which still belongs to the 16 Oct store day.
    const { today, tomorrow } = getStoreDayRange(new Date('2026-10-16T16:55:00.000Z'))

    expect(today.toISOString()).toBe('2026-10-15T17:00:00.000Z')
    expect(tomorrow.getTime()).toBeGreaterThan(new Date('2026-10-16T16:55:00.000Z').getTime())
  })

  it('covers a sale made one minute after midnight', () => {
    const sale = new Date('2026-10-16T17:01:00.000Z')
    const { today, tomorrow } = getStoreDayRange(sale)

    expect(sale.getTime()).toBeGreaterThanOrEqual(today.getTime())
    expect(sale.getTime()).toBeLessThan(tomorrow.getTime())
  })

  it('shifts the boundary with the store clock, not the server clock', () => {
    const beforeMidnightWib = getStoreDayRange(new Date('2026-10-16T16:59:00.000Z'))
    const afterMidnightWib = getStoreDayRange(new Date('2026-10-16T17:01:00.000Z'))

    expect(beforeMidnightWib.today.getTime()).not.toBe(afterMidnightWib.today.getTime())
    expect(afterMidnightWib.today.getTime() - beforeMidnightWib.today.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('reports the store date as YYYY-MM-DD', () => {
    expect(getStoreDateKey(new Date('2026-10-16T17:13:00.000Z'))).toBe('2026-10-17')
    expect(getStoreDateKey(new Date('2026-10-16T10:00:00.000Z'))).toBe('2026-10-16')
  })

  it('is stable across the whole day', () => {
    const midnightWib = Date.parse('2026-10-16T17:00:00.000Z')
    const justAfter = getStoreDayRange(new Date(midnightWib + WIB_OFFSET_MS)).today.getTime()
    const justBefore = getStoreDayRange(new Date(midnightWib - 1000)).today.getTime()

    expect(justAfter).toBe(midnightWib)
    expect(justBefore).toBe(midnightWib - 24 * 60 * 60 * 1000)
  })
})