import { describe, test, expect } from 'vitest'
import {
  MAX_RUPIAH,
  formatRupiah,
  formatRupiahInput,
  isRupiahAmount,
  parseRupiah,
} from '../rupiah'

describe('parseRupiah', () => {
  test('angka dengan koma ribuan menjadi 50000', () => {
    expect(parseRupiah('50,000')).toBe(50000)
  })

  test('angka dengan titik ribuan menjadi 50000', () => {
    expect(parseRupiah('50.000')).toBe(50000)
  })

  test('angka polos tetap 50000', () => {
    expect(parseRupiah('50000')).toBe(50000)
  })

  test('pemisah spasi menjadi 50000', () => {
    expect(parseRupiah('50 000')).toBe(50000)
  })

  test('awalan Rp dan titik menjadi 50000', () => {
    expect(parseRupiah('Rp 50.000')).toBe(50000)
  })

  test('string kosong menjadi 0', () => {
    expect(parseRupiah('')).toBe(0)
  })

  test('teks tanpa digit menjadi 0', () => {
    expect(parseRupiah('abc')).toBe(0)
  })

  test('nol menjadi 0', () => {
    expect(parseRupiah('0')).toBe(0)
  })

  test('tanda minus dibuang sehingga -5 menjadi 5', () => {
    expect(parseRupiah('-5')).toBe(5)
  })

  test('desimal dibuang digit-nya sehingga 50.5 menjadi 505', () => {
    expect(parseRupiah('50.5')).toBe(505)
  })

  test('nilai sangat besar dibatasi ke MAX_RUPIAH', () => {
    expect(parseRupiah('123456789012345678901234567890')).toBe(MAX_RUPIAH)
    expect(parseRupiah('9'.repeat(400))).toBe(MAX_RUPIAH)
  })

  test('number negatif menjadi 0', () => {
    expect(parseRupiah(-500)).toBe(0)
  })

  test('number desimal dipotong', () => {
    expect(parseRupiah(50000.9)).toBe(50000)
  })

  test('null dan undefined menjadi 0', () => {
    expect(parseRupiah(null)).toBe(0)
    expect(parseRupiah(undefined)).toBe(0)
  })
})

describe('formatRupiah', () => {
  test('memberi pemisah titik ribuan', () => {
    expect(formatRupiah(50000)).toBe('50.000')
  })

  test('nol tetap 0', () => {
    expect(formatRupiah(0)).toBe('0')
  })

  test('jutaan', () => {
    expect(formatRupiah(1234567)).toBe('1.234.567')
  })

  test('batas maksimum', () => {
    expect(formatRupiah(MAX_RUPIAH)).toBe('999.999.999')
  })

  test('nilai di atas batas dipotong', () => {
    expect(formatRupiah(1_500_000_000)).toBe('999.999.999')
  })

  test('desimal dipotong', () => {
    expect(formatRupiah(50.9)).toBe('50')
  })

  test('negatif menjadi 0', () => {
    expect(formatRupiah(-1)).toBe('0')
  })
})

describe('isRupiahAmount', () => {
  test('menerima bilangan bulat non-negatif', () => {
    expect(isRupiahAmount(0)).toBe(true)
    expect(isRupiahAmount(50000)).toBe(true)
    expect(isRupiahAmount(MAX_RUPIAH)).toBe(true)
  })

  test('menolak string berformat', () => {
    expect(isRupiahAmount('50000')).toBe(false)
    expect(isRupiahAmount('50.000')).toBe(false)
  })

  test('menolak desimal, negatif, NaN, dan tak hingga', () => {
    expect(isRupiahAmount(50.5)).toBe(false)
    expect(isRupiahAmount(-1)).toBe(false)
    expect(isRupiahAmount(Number.NaN)).toBe(false)
    expect(isRupiahAmount(Number.POSITIVE_INFINITY)).toBe(false)
  })

  test('menolak nilai di atas batas', () => {
    expect(isRupiahAmount(MAX_RUPIAH + 1)).toBe(false)
  })
})

describe('formatRupiahInput', () => {
  test('menempel teks berformat di akhir', () => {
    const result = formatRupiahInput('Rp 50.000', 'Rp 50.000'.length)
    expect(result.value).toBe(50000)
    expect(result.formatted).toBe('50.000')
    expect(result.caret).toBe('50.000'.length)
  })

  test('mengetik angka menghasilkan format berjalan', () => {
    const result = formatRupiahInput('5000', 4)
    expect(result.value).toBe(5000)
    expect(result.formatted).toBe('5.000')
    expect(result.caret).toBe(5)
  })

  test('menghapus titik di tengah tidak menggeser kursor salah', () => {
    const raw = '50000'
    const result = formatRupiahInput(raw, 2)
    expect(result.value).toBe(50000)
    expect(result.formatted).toBe('50.000')
    expect(result.caret).toBe(2)
  })

  test('menghapus digit di tengah', () => {
    const result = formatRupiahInput('50.00', 3)
    expect(result.value).toBe(5000)
    expect(result.formatted).toBe('5.000')
    expect(result.caret).toBe(3)
  })

  test('kursor di awal', () => {
    const result = formatRupiahInput('50.000', 0)
    expect(result.caret).toBe(0)
  })

  test('string kosong menjadi state kosong', () => {
    const result = formatRupiahInput('', 0)
    expect(result.empty).toBe(true)
    expect(result.formatted).toBe('')
    expect(result.value).toBe(0)
  })

  test('input sangat besar tetap dibatasi dan kursor di akhir', () => {
    const raw = '1234567890123'
    const result = formatRupiahInput(raw, raw.length)
    expect(result.value).toBe(MAX_RUPIAH)
    expect(result.formatted).toBe('999.999.999')
    expect(result.caret).toBe('999.999.999'.length)
  })
})
