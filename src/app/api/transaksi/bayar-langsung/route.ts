import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { apiRateLimiter } from '@/lib/rate-limiter'
import { getOpenShift } from '@/lib/kasir-shift'
import { getStoreDayRange } from '@/lib/time'
import { VALID_TABLE_NAMES } from '@/lib/table-layout'
import {
  DAILY_TRANSACTION_LIMIT,
  isValidIdempotencyKey,
  parseCheckoutItems,
  parseMetodePembayaran,
  resolveCheckoutItems,
  validateCashPayment,
  type CashPaymentMeta,
  type CheckoutItemInput,
  type MetodePembayaranInput,
} from '@/lib/transaksi-checkout'

const TRANSAKSI_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
} as const

type CheckoutOrder = Prisma.TransaksiGetPayload<{ include: typeof TRANSAKSI_INCLUDE }>

class CheckoutError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'CheckoutError'
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

async function findByIdempotencyKey(warungId: string, idempotencyKey: string) {
  return prisma.transaksi.findFirst({
    where: { warungId, idempotencyKey },
    include: TRANSAKSI_INCLUDE,
  })
}

function cashForExisting(
  metodePembayaran: MetodePembayaranInput,
  uangDiterima: unknown,
  total: number,
): CashPaymentMeta | null {
  if (metodePembayaran !== 'CASH') return null
  const cash = validateCashPayment(uangDiterima, total)
  if (!cash.ok) {
    throw new CheckoutError(422, cash.message)
  }
  return cash.meta
}

async function executeCheckout(
  warungId: string,
  kasirId: string,
  nomorMeja: string,
  orderId: string | null,
  items: CheckoutItemInput[],
  metodePembayaran: MetodePembayaranInput,
  uangDiterima: unknown,
  idempotencyKey: string,
) {
  return prisma.$transaction(async (tx) => {
    const existingByKey = await tx.transaksi.findFirst({
      where: { warungId, idempotencyKey },
      include: TRANSAKSI_INCLUDE,
    })

    if (existingByKey) {
      if (existingByKey.status !== 'SELESAI') {
        throw new CheckoutError(409, 'Pembayaran dengan key ini masih diproses. Coba lagi.')
      }
      return {
        transaksi: existingByKey,
        cash: cashForExisting(metodePembayaran, uangDiterima, existingByKey.total),
        idempotent: true,
      }
    }

    const shift = await getOpenShift(tx, warungId)
    if (!shift) {
      throw new CheckoutError(409, 'Buka kasir terlebih dahulu.')
    }

    const completedInShift = await tx.transaksi.count({
      where: { warungId, shiftId: shift.id, status: 'SELESAI' },
    })
    if (completedInShift >= DAILY_TRANSACTION_LIMIT) {
      throw new CheckoutError(409, `Batas ${DAILY_TRANSACTION_LIMIT} transaksi per shift sudah tercapai.`)
    }

    const resolved = await resolveCheckoutItems(tx, warungId, items)
    if (!resolved.ok) {
      throw new CheckoutError(422, resolved.message)
    }

    let existingOrder: CheckoutOrder | null = null
    if (orderId) {
      existingOrder = await tx.transaksi.findFirst({
        where: { id: orderId, warungId, shiftId: shift.id, status: 'OPEN' },
        include: TRANSAKSI_INCLUDE,
      })
      if (!existingOrder) {
        throw new CheckoutError(409, 'Order tersimpan tidak ditemukan atau sudah dibayar. Muat ulang halaman.')
      }
      if (existingOrder.nomorMeja !== nomorMeja) {
        throw new CheckoutError(422, 'Nomor meja tidak sesuai dengan order tersimpan.')
      }
    } else {
      const tableOrder = await tx.transaksi.findFirst({
        where: { warungId, shiftId: shift.id, nomorMeja, status: 'OPEN' },
        select: { id: true },
      })
      if (tableOrder) {
        throw new CheckoutError(409, 'Meja ini sudah punya order tersimpan. Pilih order tersebut untuk dibayar.')
      }
    }

    const existingTotal = existingOrder?.items.reduce((sum, item) => sum + item.subtotal, 0) ?? 0
    if (existingOrder && (existingOrder.items.length === 0 || existingTotal < 1)) {
      throw new CheckoutError(422, 'Order belum punya item pesanan.')
    }

    const total = existingTotal + resolved.total
    if (total < 1) {
      throw new CheckoutError(422, 'Total pembayaran tidak valid.')
    }

    const cash = cashForExisting(metodePembayaran, uangDiterima, total)
    const printedAt = new Date()

    if (!existingOrder) {
      const transaksi = await tx.transaksi.create({
        data: {
          warungId,
          kasirId,
          shiftId: shift.id,
          nomorMeja,
          status: 'SELESAI',
          metodePembayaran,
          total,
          tanggal: getStoreDayRange(shift.dibukaPada ?? new Date()).today,
          printedAt,
          idempotencyKey,
          items: { create: resolved.items },
        },
        include: TRANSAKSI_INCLUDE,
      })

      return { transaksi, cash, idempotent: false }
    }

    if (resolved.items.length > 0) {
      await tx.transaksiItem.createMany({
        data: resolved.items.map((item) => ({ ...item, transaksiId: existingOrder.id })),
      })
    }

    const claimed = await tx.transaksi.updateMany({
      where: { id: existingOrder.id, warungId, shiftId: shift.id, status: 'OPEN' },
      data: {
        status: 'SELESAI',
        metodePembayaran,
        total,
        printedAt,
        idempotencyKey,
      },
    })

    if (claimed.count !== 1) {
      throw new CheckoutError(409, 'Order ini baru saja dibayar oleh proses lain. Muat ulang halaman.')
    }

    const transaksi = await tx.transaksi.findUnique({
      where: { id: existingOrder.id },
      include: TRANSAKSI_INCLUDE,
    })
    if (!transaksi) {
      throw new CheckoutError(500, 'Gagal memuat transaksi setelah pembayaran.')
    }

    return { transaksi, cash, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

async function checkoutWithRetry(
  ...args: Parameters<typeof executeCheckout>
): Promise<Awaited<ReturnType<typeof executeCheckout>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await executeCheckout(...args)
    } catch (error) {
      if (attempt < 2 && isPrismaError(error, 'P2034')) continue
      throw error
    }
  }
}

export async function POST(request: NextRequest) {
  let warungId: string | null = null
  let idempotencyKey: string | null = null
  let metodePembayaran: MetodePembayaranInput | null = null
  let uangDiterima: unknown

  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }

    const rateLimitKey = `bayar-langsung:${warungId}:${context!.user.id}`
    const { allowed } = apiRateLimiter.check(rateLimitKey)
    if (!allowed) {
      return NextResponse.json({ success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' }, { status: 429 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, message: 'Data pembayaran tidak valid.' }, { status: 400 })
    }

    const payload = body as Record<string, unknown>
    const nomorMeja = typeof payload.nomorMeja === 'string' ? payload.nomorMeja.trim() : ''
    idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null
    metodePembayaran = parseMetodePembayaran(payload.metodePembayaran)
    uangDiterima = payload.uangDiterima
    const orderId = typeof payload.orderId === 'string' && payload.orderId.trim() ? payload.orderId.trim() : null
    const items = parseCheckoutItems(payload.items, Boolean(orderId))

    if (!nomorMeja) {
      return NextResponse.json({ success: false, message: 'Nomor meja wajib diisi.' }, { status: 422 })
    }
    if (!VALID_TABLE_NAMES.has(nomorMeja)) {
      return NextResponse.json({ success: false, message: 'Nomor meja tidak valid.' }, { status: 422 })
    }
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return NextResponse.json({ success: false, message: 'Idempotency key tidak valid.' }, { status: 422 })
    }
    if (!metodePembayaran) {
      return NextResponse.json({ success: false, message: 'Metode pembayaran tidak valid.' }, { status: 422 })
    }
    if (!items.ok) {
      return NextResponse.json({ success: false, message: items.message }, { status: 422 })
    }
    if (payload.orderId !== undefined && payload.orderId !== null && !orderId) {
      return NextResponse.json({ success: false, message: 'Order tersimpan tidak valid.' }, { status: 422 })
    }
    if (metodePembayaran === 'CASH' && (typeof uangDiterima !== 'number' || !Number.isInteger(uangDiterima) || uangDiterima < 0)) {
      return NextResponse.json({ success: false, message: 'Uang diterima wajib diisi dengan angka bulat.' }, { status: 422 })
    }

    const result = await checkoutWithRetry(
      warungId,
      context!.user.id,
      nomorMeja,
      orderId,
      items.items,
      metodePembayaran,
      uangDiterima,
      idempotencyKey,
    )

    return NextResponse.json({
      success: true,
      data: result.transaksi,
      meta: {
        idempotent: result.idempotent,
        cash: result.cash,
      },
    }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }

    if (isPrismaError(error, 'P2002')) {
      if (warungId && idempotencyKey) {
        const existing = await findByIdempotencyKey(warungId, idempotencyKey)
        if (existing) {
          try {
            const cash = metodePembayaran
              ? cashForExisting(metodePembayaran, uangDiterima, existing.total)
              : null
            return NextResponse.json({
              success: true,
              data: existing,
              meta: { idempotent: true, cash },
            })
          } catch (cashError) {
            if (cashError instanceof CheckoutError) {
              return NextResponse.json({ success: false, message: cashError.message }, { status: cashError.status })
            }
            throw cashError
          }
        }
      }
      return NextResponse.json({ success: false, message: 'Pembayaran ini sudah diproses. Muat ulang halaman.' }, { status: 409 })
    }

    if (isPrismaError(error, 'P2034')) {
      return NextResponse.json({ success: false, message: 'Pembayaran sedang diproses oleh transaksi lain. Coba lagi.' }, { status: 409 })
    }

    console.error('[POST /api/transaksi/bayar-langsung]', error)
    return NextResponse.json({ success: false, message: 'Gagal memproses pembayaran.' }, { status: 500 })
  }
}
