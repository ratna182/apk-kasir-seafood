import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { apiRateLimiter } from '@/lib/rate-limiter'
import { getOpenShift } from '@/lib/kasir-shift'
import { VALID_TABLE_NAMES } from '@/lib/table-layout'
import { parseCheckoutItems, resolveCheckoutItems } from '@/lib/transaksi-checkout'

const TRANSAKSI_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
} as const

export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }

    const { allowed } = apiRateLimiter.check(`preview-nota:${warungId}:${context!.user.id}`)
    if (!allowed) {
      return NextResponse.json({ success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' }, { status: 429 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, message: 'Data preview tidak valid.' }, { status: 422 })
    }

    const nomorMeja = typeof body.nomorMeja === 'string' ? body.nomorMeja.trim() : ''
    if (!nomorMeja) {
      return NextResponse.json({ success: false, message: 'Nomor meja wajib diisi.' }, { status: 422 })
    }
    if (!VALID_TABLE_NAMES.has(nomorMeja)) {
      return NextResponse.json({ success: false, message: 'Nomor meja harus Meja 1-15, Lesehan 1-11, atau Bungkus.' }, { status: 422 })
    }

    const rawOrderId = body.orderId
    if (rawOrderId !== undefined && rawOrderId !== null && typeof rawOrderId !== 'string') {
      return NextResponse.json({ success: false, message: 'Order tersimpan tidak valid.' }, { status: 422 })
    }
    const orderId = typeof rawOrderId === 'string' ? rawOrderId.trim() : null
    if (rawOrderId !== undefined && rawOrderId !== null && !orderId) {
      return NextResponse.json({ success: false, message: 'Order tersimpan tidak valid.' }, { status: 422 })
    }

    const parsedItems = parseCheckoutItems(body.items, Boolean(orderId))
    if (!parsedItems.ok) {
      return NextResponse.json({ success: false, message: parsedItems.message }, { status: 422 })
    }

    const [shift, warung] = await Promise.all([
      getOpenShift(prisma, warungId),
      prisma.warung.findUnique({ where: { id: warungId }, select: { nama: true, alamat: true } }),
    ])

    if (!warung) {
      return NextResponse.json({ success: false, message: 'Warung tidak ditemukan.' }, { status: 403 })
    }
    if (!shift) {
      return NextResponse.json({ success: false, message: 'Buka kasir terlebih dahulu.' }, { status: 409 })
    }

    let existingOrder = null
    if (orderId) {
      existingOrder = await prisma.transaksi.findFirst({
        where: { id: orderId, warungId, shiftId: shift.id, status: 'OPEN' },
        include: TRANSAKSI_INCLUDE,
      })
      if (!existingOrder) {
        return NextResponse.json({ success: false, message: 'Order tersimpan tidak ditemukan atau sudah dibayar. Muat ulang halaman.' }, { status: 409 })
      }
      if (existingOrder.nomorMeja !== nomorMeja) {
        return NextResponse.json({ success: false, message: 'Nomor meja tidak sesuai dengan order tersimpan.' }, { status: 422 })
      }
    } else {
      const tableOrder = await prisma.transaksi.findFirst({
        where: { warungId, shiftId: shift.id, nomorMeja, status: 'OPEN' },
        select: { id: true },
      })
      if (tableOrder) {
        return NextResponse.json({ success: false, message: 'Meja ini sudah punya order tersimpan. Pilih order tersebut untuk melihat nota.' }, { status: 409 })
      }
    }

    const resolved = await resolveCheckoutItems(prisma, warungId, parsedItems.items)
    if (!resolved.ok) {
      return NextResponse.json({ success: false, message: resolved.message }, { status: 422 })
    }

    const existingItems = existingOrder?.items.map((item) => ({
      namaMenu: item.namaMenu,
      qty: item.qty,
      hargaSatuan: item.hargaSatuan,
      diskonSatuan: item.diskonSatuan,
      catatan: item.catatan,
      subtotal: item.subtotal,
    })) ?? []
    const existingTotal = existingItems.reduce((sum, item) => sum + item.subtotal, 0)

    if (existingOrder && (existingItems.length === 0 || existingTotal < 1)) {
      return NextResponse.json({ success: false, message: 'Order belum punya item pesanan.' }, { status: 422 })
    }

    const total = existingTotal + resolved.total
    if (total < 1) {
      return NextResponse.json({ success: false, message: 'Total pembayaran tidak valid.' }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      data: {
        orderId: existingOrder?.id ?? null,
        nomorMeja,
        warungNama: warung.nama,
        warungAlamat: warung.alamat,
        generatedAt: new Date().toISOString(),
        items: [...existingItems, ...resolved.items],
        total,
        existingTotal,
        addedTotal: resolved.total,
      },
    })
  } catch (error) {
    console.error('[POST /api/transaksi/preview-nota]', error)
    return NextResponse.json({ success: false, message: 'Gagal memuat preview nota.' }, { status: 500 })
  }
}
