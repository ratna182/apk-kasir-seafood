import type { PrinterConfig } from './types'

const STORAGE_KEY = 'kasir_printer_config'
const BUILT_IN_WIDTH_KEY = 'kasir_printer_builtin_width'

export function savePrinterConfig(config: PrinterConfig): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {}
}

export function loadPrinterConfig(): PrinterConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return applyBuiltinPaperWidth(JSON.parse(raw) as PrinterConfig)
  } catch {
    return null
  }
}

/**
 * The built-in printer runs on an 80 mm roll, so a config saved with the old 58 mm default is
 * widened once. Bluetooth printers keep whatever width the user picked.
 */
function applyBuiltinPaperWidth(config: PrinterConfig): PrinterConfig {
  if (config.connectionType !== 'imin') return config
  if (config.width === '80mm') return config
  if (localStorage.getItem(BUILT_IN_WIDTH_KEY) === '80mm') return { ...config, width: '80mm' }
  try {
    localStorage.setItem(BUILT_IN_WIDTH_KEY, '80mm')
  } catch {}
  const migrated = { ...config, width: '80mm' as const }
  savePrinterConfig(migrated)
  return migrated
}

export function clearPrinterConfig(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(BUILT_IN_WIDTH_KEY)
  } catch {}
}
