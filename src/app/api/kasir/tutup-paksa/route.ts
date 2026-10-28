import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'
import { formatWibDateTime } from '@/lib/time'
import { recordActivity } from '@/lib/activity-log'
import { apiRateLimiter } from '@/lib/rate-limiter'

// POST /api/kasir/tutup-paksa — owner menutup shift yang melewati batas 18 jam.
export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const body = await request.json().catch(() => ({}))
    const warungId = body.warungId?.toString()
    const catatan = typeof body.catatan === 'string' ? body.catatan.trim() : ''
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
    }
    if (catatan.length < 5) {
      return NextResponse.json({ success: false, message: 'Catatan tutup paksa wajib diisi minimal 5 karakter.' }, { status: 422 })
    }

    const rateLimitKey = `kasir:tutup-paksa:${warungId}:${context!.user.id}`
    const { allowed } = apiRateLimiter.check(rateLimitKey)
    if (!allowed) {
      return NextResponse.json({ success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' }, { status: 429 })
    }

    const userId = context!.user.id
    const closedAt = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const open = await getOpenShift(tx, warungId)
      if (!open) return { type: 'NOT_OPEN' as const }

      const cancelled = await tx.transaksi.updateMany({
        where: { warungId, shiftId: open.id, status: 'OPEN' },
        data: { status: 'BATAL' },
      })
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
          catatanTutup: catatan.slice(0, 500),
        },
      })
      await tx.kasirShiftEvent.create({
        data: {
          shiftId: shift.id,
          warungId,
          userId,
          jenis: 'PAKSA_TUTUP',
          waktu: closedAt,
          catatan: catatan.slice(0, 500),
        },
      })

      return {
        type: 'CLOSED' as const,
        shift,
        cancelledOrders: cancelled.count,
        totalTransaksi: aggregate._count.id,
        totalPendapatan: aggregate._sum.total ?? 0,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.type === 'NOT_OPEN') {
      return NextResponse.json({ success: false, message: 'Tidak ada shift yang terbuka.' }, { status: 409 })
    }

    try {
      await recordActivity(prisma, {
        userId,
        warungId,
        aktivitas: 'TUTUP_KASIR',
        detail: `Tutup paksa shift, ${result.totalTransaksi} transaksi, ${result.cancelledOrders} order batal. Catatan: ${catatan}`,
      })
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      message: `Shift ditutup paksa pada ${formatWibDateTime(closedAt)} WIB.`,
      data: {
        shiftId: result.shift.id,
        ditutupPada: result.shift.ditutupPada?.toISOString() ?? closedAt.toISOString(),
        cancelledOrders: result.cancelledOrders,
        totalTransaksi: result.totalTransaksi,
        totalPendapatan: result.totalPendapatan,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ success: false, message: 'Status kasir baru saja berubah. Silakan coba lagi.' }, { status: 409 })
    }
    console.error('[POST /api/kasir/tutup-paksa]', error)
    return NextResponse.json({ success: false, message: 'Gagal menutup paksa shift.' }, { status: 500 })
  }
}
