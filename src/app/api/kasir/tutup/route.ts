import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireKasirAccess } from '@/lib/auth'
import { getLatestShift, getOpenShift } from '@/lib/kasir-shift'
import { formatWibDateTime } from '@/lib/time'
import { recordActivity } from '@/lib/activity-log'
import { apiRateLimiter } from '@/lib/rate-limiter'

// POST /api/kasir/tutup — tutup shift kasir yang sedang terbuka
export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const body = await request.json().catch(() => ({}))
    const warungId = context!.user.role === 'KASIR' ? context!.warungId : body.warungId?.toString()
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
    }
    if (context!.user.role === 'OWNER' && !await prisma.warung.findUnique({ where: { id: warungId }, select: { id: true } })) {
      return NextResponse.json({ success: false, message: 'Warung tidak ditemukan.' }, { status: 400 })
    }

    const rateLimitKey = `kasir:tutup:${warungId}:${context!.user.id}`
    const { allowed } = apiRateLimiter.check(rateLimitKey)
    if (!allowed) {
      return NextResponse.json({ success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' }, { status: 429 })
    }

    const userId = context!.user.id
    const catatan = typeof body.catatan === 'string' ? body.catatan.trim().slice(0, 500) || null : null
    const closedAt = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const open = await getOpenShift(tx, warungId)
      if (!open) {
        const latest = await getLatestShift(tx, warungId)
        return { type: 'ALREADY_CLOSED' as const, latest }
      }

      const openOrders = await tx.transaksi.findMany({
        where: { warungId, shiftId: open.id, status: 'OPEN' },
        select: { nomorMeja: true },
      })
      if (openOrders.length > 0) return { type: 'OPEN_ORDERS' as const, openOrders }

      const aggregate = await tx.transaksi.aggregate({
        where: { warungId, shiftId: open.id, status: 'SELESAI' },
        _count: { id: true },
        _sum: { total: true },
      })

      const shift = await tx.kasirShift.update({
        where: { id: open.id },
        data: {
          status: 'DITUTUP',
          ditutupPada: closedAt,
          ditutupOleh: userId,
          catatanTutup: catatan,
        },
      })
      await tx.kasirShiftEvent.create({
        data: {
          shiftId: shift.id,
          warungId,
          userId,
          jenis: 'TUTUP',
          waktu: closedAt,
          catatan,
        },
      })

      return {
        type: 'CLOSED' as const,
        shift,
        totalTransaksi: aggregate._count.id,
        totalPendapatan: aggregate._sum.total ?? 0,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.type === 'ALREADY_CLOSED') {
      const message = result.latest?.ditutupPada
        ? `Tidak ada shift yang terbuka. Shift terakhir ditutup pada ${formatWibDateTime(result.latest.ditutupPada)} WIB.`
        : 'Tidak ada shift yang terbuka. Buka kasir terlebih dahulu.'
      return NextResponse.json({ success: false, message }, { status: 409 })
    }
    if (result.type === 'OPEN_ORDERS') {
      const meja = result.openOrders.map((order) => order.nomorMeja).join(', ')
      return NextResponse.json({
        success: false,
        message: `Masih ada pesanan yang belum dibayar di ${meja}. Selesaikan pesanan tersebut sebelum tutup kasir.`,
      }, { status: 409 })
    }

    try {
      await recordActivity(prisma, {
        userId,
        warungId,
        aktivitas: 'TUTUP_KASIR',
        detail: `Kasir ditutup, ${result.totalTransaksi} transaksi, pendapatan Rp ${result.totalPendapatan.toLocaleString('id-ID')}`,
      })
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      data: {
        shiftId: result.shift.id,
        dibukaPada: result.shift.dibukaPada?.toISOString() ?? null,
        ditutupPada: result.shift.ditutupPada?.toISOString() ?? closedAt.toISOString(),
        totalTransaksi: result.totalTransaksi,
        totalPendapatan: result.totalPendapatan,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ success: false, message: 'Status kasir baru saja berubah. Silakan coba lagi.' }, { status: 409 })
    }
    console.error('[POST /api/kasir/tutup]', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, message: `Gagal menutup kasir: ${msg}` }, { status: 500 })
  }
}
