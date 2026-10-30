import { CHAR_WIDTHS } from './types'
import { loadReceiptLogo } from './logo'
import { createWriter } from './layout'
import {
  buildReceiptLines,
  createReceiptData,
  type CreateReceiptInput,
} from './receipt-content'
import {
  initPrinter,
  feedAndCut,
  setAlign,
  setLineSpacing,
  compose,
  setCharset,
  setCodePage,
  setPrintDensity,
  setFontSize,
  CUT_FEED_LINES,
} from './escpos'

export type { ReceiptTransaction } from './receipt-content'

export interface EncodeReceiptInput extends CreateReceiptInput {
  width: '58mm' | '80mm'
  username?: string
  warungKode?: string | null
}

export async function encodeReceipt(data: EncodeReceiptInput): Promise<Uint8Array> {
  const w = CHAR_WIDTHS[data.width]
  const { emit } = createWriter(w)
  const parts: Uint8Array[] = []

  parts.push(initPrinter())
  parts.push(setCharset(0))
  parts.push(setCodePage(0))
  parts.push(setPrintDensity(7))
  parts.push(setLineSpacing(20))
  parts.push(setFontSize(1, 1))

  const logo = await loadReceiptLogo(w)
  if (logo) {
    parts.push(setAlign('center'))
    parts.push(logo)
    parts.push(setAlign('left'))
  }

  const receipt = createReceiptData(data)
  for (const line of buildReceiptLines(receipt, w)) {
    parts.push(emit(line.text, { scale: line.scale }))
  }

  parts.push(setLineSpacing(20))
  parts.push(feedAndCut(CUT_FEED_LINES))

  return compose(...parts)
}
