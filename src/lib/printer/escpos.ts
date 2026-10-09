function bytes(...arr: number[]): Uint8Array {
  return new Uint8Array(arr)
}

function textEncoder(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function initPrinter(): Uint8Array {
  // Initialize printer and clear buffer
  return bytes(0x1B, 0x40)
}

export function feedAndCut(lines: number = 3): Uint8Array {
  const feed = new Uint8Array(lines)
  feed.fill(0x0A)
  const cut = bytes(0x1D, 0x56, 0x00)
  const result = new Uint8Array(feed.length + cut.length)
  result.set(feed)
  result.set(cut, feed.length)
  return result
}

export function setText(text: string): Uint8Array {
  return textEncoder(text.normalize('NFKD').replace(/[^\x20-\x7E\n\r]/g, '?'))
}

export function setAlign(mode: 'left' | 'center' | 'right'): Uint8Array {
  const code = mode === 'center' ? 0x01 : mode === 'right' ? 0x02 : 0x00
  return bytes(0x1B, 0x61, code)
}

export function setBold(on: boolean): Uint8Array {
  return bytes(0x1B, 0x45, on ? 0x01 : 0x00)
}

export function setFontSize(width: 1 | 2, height: 1 | 2 = 1): Uint8Array {
  const n = ((width - 1) << 4) | (height - 1)
  return bytes(0x1D, 0x21, n)
}

export function setLineSpacing(spacing: number): Uint8Array {
  return bytes(0x1B, 0x33, spacing)
}

export function compose(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

export function padRight(text: string, totalWidth: number): string {
  if (text.length >= totalWidth) return text.slice(0, totalWidth)
  return text + ' '.repeat(totalWidth - text.length)
}

export function drawLine(width: number): string {
  return '-'.repeat(width)
}

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

// Additional ESC/POS commands for better compatibility
export function setCharset(charset: number = 0): Uint8Array {
  // Set character set (0 = USA, 1 = France, etc.)
  return bytes(0x1B, 0x52, charset)
}

export function setCodePage(codepage: number = 0): Uint8Array {
  // Set code page (0 = CP437, 1 = CP850, etc.)
  return bytes(0x1B, 0x74, codepage)
}

export function setInternalFont(font: 'A' | 'B' = 'A'): Uint8Array {
  // Set internal font (A or B)
  return bytes(0x1B, 0x4D, font === 'A' ? 0x00 : 0x01)
}

export function setPrintDensity(density: number = 7): Uint8Array {
  // Set print density (0-15, default 7)
  return bytes(0x1D, 0x7C, density)
}

export function setPrintSpeed(speed: number = 3): Uint8Array {
  // Set print speed (0-7, default 3)
  return bytes(0x1D, 0x7B, speed)
}

export function setStatusBackCommand(): Uint8Array {
  // Enable status back command
  return bytes(0x1B, 0x3D, 0x02)
}

export function enablePanelButtons(): Uint8Array {
  // Enable panel buttons
  return bytes(0x1B, 0x63, 0x05, 0x00)
}

export function setUpsideDownMode(on: boolean): Uint8Array {
  // Set upside down mode
  return bytes(0x1B, 0x7B, on ? 0x01 : 0x00)
}

export function setWhiteOnBlack(on: boolean): Uint8Array {
  // Set white on black mode
  return bytes(0x1D, 0x42, on ? 0x01 : 0x00)
}

export function underline(mode: 0 | 1 | 2 = 0): Uint8Array {
  // 0 = off, 1 = single, 2 = double
  return bytes(0x1B, 0x2D, mode)
}

export function setCharacterSpacing(spacing: number = 0): Uint8Array {
  // Set character spacing (0-8)
  return bytes(0x1B, 0x20, spacing)
}

export function setLeftMargin(margin: number = 0): Uint8Array {
  // Set left margin (0-255)
  return bytes(0x1D, 0x6C, margin)
}

export function setPrintAreaWidth(width: number = 48): Uint8Array {
  // Set print area width (for 80mm printer, default 48 characters)
  const nL = width & 0xFF
  const nH = (width >> 8) & 0xFF
  return bytes(0x1D, 0x57, nL, nH)
}

export function setAbsolutePosition(position: number = 0): Uint8Array {
  // Set absolute position
  const nL = position & 0xFF
  const nH = (position >> 8) & 0xFF
  return bytes(0x1B, 0x24, nL, nH)
}

export function setRelativePosition(position: number = 0): Uint8Array {
  // Set relative position
  const nL = position & 0xFF
  const nH = (position >> 8) & 0xFF
  return bytes(0x1B, 0x5C, nL, nH)
}

export function printNVImage(imageNumber: number = 1): Uint8Array {
  // Print NV image from flash memory
  return bytes(0x1C, 0x70, imageNumber, 0x00)
}

export function selectUserNVImage(imageNumber: number = 1): Uint8Array {
  // Select user NV image
  return bytes(0x1C, 0x70, imageNumber, 0x01)
}

export function setHorizontalTab(position: number = 8): Uint8Array {
  // Set horizontal tab position
  return bytes(0x1B, 0x44, position, 0x00)
}

export function setVerticalTabPositions(positions: number[]): Uint8Array {
  // Set vertical tab positions
  const bytes_arr = [0x1B, 0x42]
  for (const pos of positions) {
    bytes_arr.push(pos)
  }
  bytes_arr.push(0x00)
  return bytes(...bytes_arr)
}

export function setPanelButton(mode: number = 0): Uint8Array {
  // Set panel button mode (0 = disabled, 1 = enabled)
  return bytes(0x1B, 0x63, 0x07, mode)
}

export function setBuzzer(m: number = 1, t: number = 1, n: number = 1): Uint8Array {
  // Set buzzer (m = mode, t = time, n = count)
  return bytes(0x1B, 0x42, m, t, n)
}

export function setDrawer(pin: number = 0, t1: number = 1, t2: number = 1): Uint8Array {
  // Set drawer control
  return bytes(0x1B, 0x70, pin, t1, t2)
}
