/**
 * Store day boundaries.
 *
 * The server runs in UTC while the store trades in WIB, so `new Date().setHours(0, 0, 0, 0)`
 * would mean 07:00 in Jakarta. Sales between midnight and 07:00 WIB would then land on the
 * previous day for the owner and vanish from the daily report. Asia/Jakarta has no daylight
 * saving, so a fixed offset is exact.
 */
const STORE_TIME_ZONE = 'Asia/Jakarta'
const STORE_UTC_OFFSET_MINUTES = 7 * 60

export interface DayRange {
  /** Instant of 00:00 store time. */
  today: Date
  /** Instant of 00:00 store time on the next day. */
  tomorrow: Date
}

export function getStoreDayRange(now: Date = new Date()): DayRange {
  const shifted = new Date(now.getTime() + STORE_UTC_OFFSET_MINUTES * 60_000)
  const midnightUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  return {
    today: new Date(midnightUtc - STORE_UTC_OFFSET_MINUTES * 60_000),
    tomorrow: new Date(midnightUtc + 24 * 60 * 60 * 1000 - STORE_UTC_OFFSET_MINUTES * 60_000),
  }
}

/** Store day as YYYY-MM-DD, the format the report prints. */
export function getStoreDateKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + STORE_UTC_OFFSET_MINUTES * 60_000)
  return shifted.toISOString().slice(0, 10)
}

export function getStoreTimeZone(): string {
  return STORE_TIME_ZONE
}

export function formatWibDateTime(value: Date | string | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: STORE_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatWibTime(value: Date | string | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: STORE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
