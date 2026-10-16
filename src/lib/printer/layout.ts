import {
  compose,
  setAlign,
  setBold,
  setFontSize,
  setText,
} from './escpos'

export type Align = 'left' | 'center' | 'right'
export type Scale = 1 | 2

/**
 * Double-width text occupies two columns per character, so it only fits at half the paper width.
 * Returns the horizontal scale the line can actually use.
 */
export function fitScale(text: string, width: number, requested: Scale): Scale {
  if (requested === 1) return 1
  return text.length * 2 <= width ? 2 : 1
}

export function centerText(text: string, width: number, scale: Scale = 1): string {
  const columns = Math.max(1, Math.floor(width / scale))
  if (text.length >= columns) return text.slice(0, columns)
  return ' '.repeat(Math.floor((columns - text.length) / 2)) + text
}

export function rightText(text: string, width: number, scale: Scale = 1): string {
  const columns = Math.max(1, Math.floor(width / scale))
  if (text.length >= columns) return text.slice(0, columns)
  return ' '.repeat(columns - text.length) + text
}

/** Splits a long line instead of letting the paper clip it. */
export function wrapText(text: string, width: number): string[] {
  const columns = Math.max(1, width)
  if (text.length <= columns) return [text]
  const lines: string[] = []
  let rest = text
  while (rest.length > columns) {
    lines.push(rest.slice(0, columns))
    rest = rest.slice(columns)
  }
  if (rest.length > 0) lines.push(rest)
  return lines
}

export interface LineOptions {
  bold?: boolean
  align?: Align
  /** 2 asks for double width; it degrades to double height when the line would overflow. */
  scale?: Scale
}

/**
 * Builds receipt lines that respect the paper width: wrap instead of clip, and centre against the
 * real footprint of a scaled line.
 */
export function createWriter(width: number) {
  const emit = (text: string, options: LineOptions = {}): Uint8Array => {
    const bold = options.bold ?? true
    const align = options.align ?? 'left'
    const requested = options.scale ?? 1
    const fontWidth = fitScale(text, width, requested)
    const fontHeight = requested === 2 ? 2 : 1
    const parts: Uint8Array[] = []
    for (const chunk of wrapText(text, Math.max(1, Math.floor(width / fontWidth)))) {
      parts.push(setBold(bold))
      if (align !== 'left') parts.push(setAlign(align))
      if (fontHeight > 1) parts.push(setFontSize(fontWidth, fontHeight))
      parts.push(setText(chunk + '\n'))
      if (fontHeight > 1) parts.push(setFontSize(1, 1))
      if (align !== 'left') parts.push(setAlign('left'))
    }
    return compose(...parts)
  }

  // Centring must wrap first: centring a string wider than the paper would clip it.
  const center = (text: string, options: LineOptions = {}): Uint8Array => {
    const requested = options.scale ?? 1
    const columns = Math.max(1, Math.floor(width / fitScale(text, width, requested)))
    return compose(...wrapText(text, columns).map((chunk) => {
      const scale = fitScale(chunk, width, requested)
      return emit(centerText(chunk, width, scale), { ...options, align: 'center', scale })
    }))
  }

  const right = (text: string, options: LineOptions = {}): Uint8Array => {
    const requested = options.scale ?? 1
    const columns = Math.max(1, Math.floor(width / fitScale(text, width, requested)))
    return compose(...wrapText(text, columns).map((chunk) => {
      const scale = fitScale(chunk, width, requested)
      return emit(rightText(chunk, width, scale), { ...options, align: 'right', scale })
    }))
  }

  return { emit, center, right, width }
}

/** Places values in fixed columns and reports whether the widest field overflowed. */
export function placeColumns(
  fields: Array<{ text: string; start?: number; end?: number }>,
  width: number,
): { line: string; overflow: boolean } {
  let line = ''
  let overflow = false
  for (const field of fields) {
    const text = field.text
    if (field.start !== undefined) {
      if (field.start + text.length > width) overflow = true
      while (line.length < field.start) line += ' '
      line += text
    } else {
      const limit = (field.end ?? width) - text.length
      if (limit < line.length) overflow = true
      while (line.length < limit) line += ' '
      line += text
    }
  }
  return { line: line.slice(0, width), overflow }
}
