export const TANPA_KATEGORI = 'Tanpa kategori'

export function normalizeKategoriNama(nama: string | null | undefined): string {
  const trimmed = nama?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : TANPA_KATEGORI
}

export function isKategoriMinuman(nama: string | null | undefined): boolean {
  return normalizeKategoriNama(nama).toLocaleLowerCase('id-ID').includes('minum')
}
