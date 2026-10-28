import { describe, expect, it } from 'vitest'
import { isKategoriMinuman, normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'

describe('kategori', () => {
  it('keeps a real category name as-is', () => {
    expect(normalizeKategoriNama('Ikan Bakar')).toBe('Ikan Bakar')
    expect(normalizeKategoriNama('  Minuman  ')).toBe('Minuman')
  })

  it('falls back to Tanpa kategori when the menu category is missing', () => {
    expect(normalizeKategoriNama(null)).toBe(TANPA_KATEGORI)
    expect(normalizeKategoriNama(undefined)).toBe(TANPA_KATEGORI)
    expect(normalizeKategoriNama('   ')).toBe(TANPA_KATEGORI)
  })

  it('detects drink categories without hardcoding MAKANAN', () => {
    expect(isKategoriMinuman('Minuman')).toBe(true)
    expect(isKategoriMinuman('ES & MINUMAN')).toBe(true)
    expect(isKategoriMinuman('Ikan Bakar')).toBe(false)
    expect(isKategoriMinuman(TANPA_KATEGORI)).toBe(false)
  })
})
