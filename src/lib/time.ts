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

/** Store day boundaries for a YYYY-MM-DD key. */
export function getStoreDayRangeForDateKey(dateKey: string): DayRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return getStoreDayRange()
  const start = new Date(`${dateKey}T00:00:00.000+07:00`)
  if (Number.isNaN(start.getTime())) return getStoreDayRange()
  return { today: start, tomorrow: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

/** Store day as YYYY-MM-DD, the format the report prints. */
export function getStoreDateKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + STORE_UTC_OFFSET_MINUTES * 60_000)
  return shifted.toISOString().slice(0, 10)
}

export function getStoreTimeZone(): string {
  return STORE_TIME_ZONE
}

function wibParts(value: Date | string | null | undefined): Record<string, string> | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: STORE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
}

export function formatWibDate(value: Date | string | null | undefined): string {
  const parts = wibParts(value)
  if (!parts) return '-'
  return `${parts.day}/${parts.month}/${parts.year}`
}

export function formatWibTime(value: Date | string | null | undefined): string {
  const parts = wibParts(value)
  if (!parts) return '-'
  return `${parts.hour}:${parts.minute}`
}

/** Compact WIB date + time, e.g. 28/10 14:00. */
export function formatWibShortDateTime(value: Date | string | null | undefined): string {
  const parts = wibParts(value)
  if (!parts) return '-'
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`
}

export function formatWibDateTime(value: Date | string | null | undefined): string {
  const parts = wibParts(value)
  if (!parts) return '-'
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
}

/**
 * Shift range label. The close date is printed only when the shift closes on a
 * different store day, e.g. "Buka 28/10 14:00, Tutup 29/10 02:00 WIB".
 */
export function formatWibShiftRange(
  dibukaPada: Date | string | null | undefined,
  ditutupPada: Date | string | null | undefined,
): string {
  if (!dibukaPada) return 'Buka -, Tutup -'
  const openLabel = formatWibShortDateTime(dibukaPada)
  if (!ditutupPada) return `Buka ${openLabel}, Tutup - WIB`
  const openDate = new Date(dibukaPada)
  const closeDate = new Date(ditutupPada)
  const sameDay = getStoreDateKey(openDate) === getStoreDateKey(closeDate)
  const closeLabel = sameDay ? formatWibTime(closeDate) : formatWibShortDateTime(closeDate)
  return `Buka ${openLabel}, Tutup ${closeLabel} WIB`
}
