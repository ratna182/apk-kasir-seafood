export const MAX_RUPIAH = 999_999_999

function clampRupiah(value: number): number {
  if (!Number.isFinite(value)) return MAX_RUPIAH
  if (value < 0) return 0
  return Math.min(Math.trunc(value), MAX_RUPIAH)
}

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '')
}

export function parseRupiah(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0
  if (typeof input === 'number') return clampRupiah(input)

  const digits = digitsOnly(input)
  if (!digits) return 0
  return clampRupiah(Number.parseInt(digits, 10))
}

export function formatRupiah(value: number): string {
  return clampRupiah(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function isRupiahAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_RUPIAH
}

export interface RupiahInputFormat {
  digits: string
  value: number
  formatted: string
  caret: number
  empty: boolean
}

function caretAfterDigit(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    const code = formatted.charCodeAt(i)
    if (code >= 48 && code <= 57) {
      seen++
      if (seen === digitCount) return i + 1
    }
  }
  return formatted.length
}

export function formatRupiahInput(raw: string, caret: number): RupiahInputFormat {
  const safeCaret = Math.max(0, Math.min(caret, raw.length))
  const digitsBeforeCaret = digitsOnly(raw.slice(0, safeCaret)).length
  const digits = digitsOnly(raw)

  if (!digits) {
    return { digits: '', value: 0, formatted: '', caret: 0, empty: true }
  }

  const value = parseRupiah(digits)
  const formatted = formatRupiah(value)
  const formattedDigits = digitsOnly(formatted).length
  const targetDigit = Math.min(digitsBeforeCaret, formattedDigits)

  return {
    digits,
    value,
    formatted,
    caret: caretAfterDigit(formatted, targetDigit),
    empty: false,
  }
}
