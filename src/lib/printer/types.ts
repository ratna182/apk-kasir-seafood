export type PrinterConnectionType = 'bluetooth' | 'imin'

export interface PrinterConfig {
  deviceId: string
  deviceName: string
  width: '58mm' | '80mm'
  connectionType: PrinterConnectionType
}

export type PrinterStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported'

export const PAPER_CHARS = { '80mm': 48, '58mm': 32 } as const
export const CHAR_WIDTHS = PAPER_CHARS

// Legacy UUIDs kept for reference
export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb'
export const WRITE_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb'

// iMin SDK interface for built-in printer
export interface IMinPrinterSDK {
  connect(): Promise<boolean>
  disconnect(): Promise<void>
  print(data: Uint8Array): Promise<boolean>
  getStatus(): Promise<PrinterStatus>
  isSupported(): boolean
}

export interface IMinPrintJobResult {
  ok: boolean
  status: 'printed' | 'failed' | 'unknown'
  error: string | null
  attempts: number
}
