import type { Prisma } from '@prisma/client'
import { hitungKembalian } from './payment/cash'

export const DAILY_TRANSACTION_LIMIT = 150
export const MAX_CHECKOUT_ITEMS = 100
export const MAX_ITEM_QTY = 999
export const MAX_UNIT_PRICE = 10_000_000
export const MAX_CHECKOUT_TOTAL = 1_000_000_000

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export type MetodePembayaranInput = 'CASH' | 'QRIS' | 'TRANSFER'

export interface CheckoutItemInput {
  menuId: string
  qty: number
  hargaSatuan?: number
  diskonSatuan?: number
  catatan?: string
}

export interface ResolvedCheckoutItem {
  menuId: string
  namaMenu: string
  hargaSatuan: number
  diskonSatuan: number
  catatan: string | null
  qty: number
  subtotal: number
}

export interface CashPaymentMeta {
  uangDiterima: number
  kembalian: number
  message: string
}

type ResolveResult =
  | { ok: true; items: ResolvedCheckoutItem[]; total: number }
  | { ok: false; message: string }

type CashResult =
  | { ok: true; meta: CashPaymentMeta }
  | { ok: false; message: string }

export function parseMetodePembayaran(value: unknown): MetodePembayaranInput | null {
  return value === 'CASH' || value === 'QRIS' || value === 'TRANSFER' ? value : null
}

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value)
}

export function parseCheckoutItems(
  value: unknown,
  allowEmpty = false,
): { ok: true; items: CheckoutItemInput[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    return { ok: false, message: 'Keranjang pesanan masih kosong.' }
  }
  if (value.length > MAX_CHECKOUT_ITEMS) {
    return { ok: false, message: `Maksimal ${MAX_CHECKOUT_ITEMS} jenis item per transaksi.` }
  }

  const items: CheckoutItemInput[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: 'Item pesanan tidak valid.' }
    }
    const item = raw as Record<string, unknown>
    const menuId = typeof item.menuId === 'string' ? item.menuId.trim() : ''
    const qty = Number(item.qty)
    const hargaSatuan = item.hargaSatuan === undefined ? undefined : Number(item.hargaSatuan)
    const diskonSatuan = item.diskonSatuan === undefined ? undefined : Number(item.diskonSatuan)
    const catatan = item.catatan === undefined ? undefined : String(item.catatan)

    if (!menuId) {
      return { ok: false, message: 'Menu pada keranjang tidak valid.' }
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) {
      return { ok: false, message: `Qty harus antara 1 dan ${MAX_ITEM_QTY}.` }
    }
    if (hargaSatuan !== undefined && (!Number.isInteger(hargaSatuan) || hargaSatuan < 0 || hargaSatuan > MAX_UNIT_PRICE)) {
      return { ok: false, message: 'Harga item tidak valid.' }
    }
    if (diskonSatuan !== undefined && (!Number.isInteger(diskonSatuan) || diskonSatuan < 0 || diskonSatuan > MAX_UNIT_PRICE)) {
      return { ok: false, message: 'Diskon item tidak valid.' }
    }
    if (catatan !== undefined && catatan.length > 160) {
      return { ok: false, message: 'Catatan item maksimal 160 karakter.' }
    }

    items.push({ menuId, qty, hargaSatuan, diskonSatuan, catatan })
  }

  return { ok: true, items }
}

export async function resolveCheckoutItems(
  db: Pick<Prisma.TransactionClient, 'menu'>,
  warungId: string,
  items: CheckoutItemInput[],
): Promise<ResolveResult> {
  if (items.length === 0) {
    return { ok: true, items: [], total: 0 }
  }

  const menuIds = [...new Set(items.map((item) => item.menuId))]
  const menus = await db.menu.findMany({
    where: { id: { in: menuIds }, warungId, isAktif: true },
    include: { warungMenus: { where: { warungId }, select: { harga: true } } },
  })

  if (menus.length !== menuIds.length) {
    return { ok: false, message: 'Beberapa menu tidak valid atau sudah tidak aktif.' }
  }

  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  const resolved: ResolvedCheckoutItem[] = []
  let total = 0

  for (const item of items) {
    const menu = menusById.get(item.menuId)
    if (!menu) {
      return { ok: false, message: 'Menu pada keranjang tidak valid.' }
    }

    const effectiveHarga = menu.warungMenus[0]?.harga ?? menu.harga
    const hargaSatuan = item.hargaSatuan === undefined ? effectiveHarga : item.hargaSatuan
    const diskonSatuan = item.diskonSatuan ?? 0
    if (diskonSatuan > hargaSatuan) {
      return { ok: false, message: 'Diskon tidak boleh melebihi harga satuan.' }
    }

    const subtotal = (hargaSatuan - diskonSatuan) * item.qty
    total += subtotal
    if (total > MAX_CHECKOUT_TOTAL) {
      return { ok: false, message: 'Total transaksi melebihi batas yang diizinkan.' }
    }

    resolved.push({
      menuId: menu.id,
      namaMenu: menu.nama,
      hargaSatuan,
      diskonSatuan,
      catatan: item.catatan?.trim() || null,
      qty: item.qty,
      subtotal,
    })
  }

  if (total < 1) {
    return { ok: false, message: 'Total pembayaran tidak valid.' }
  }

  return { ok: true, items: resolved, total }
}

export function validateCashPayment(value: unknown, total: number): CashResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { ok: false, message: 'Uang diterima wajib diisi dengan angka bulat.' }
  }

  const result = hitungKembalian(value, total)
  if (!result.isValid) {
    return { ok: false, message: result.message }
  }

  return {
    ok: true,
    meta: {
      uangDiterima: value,
      kembalian: result.kembalian,
      message: result.message,
    },
  }
}
