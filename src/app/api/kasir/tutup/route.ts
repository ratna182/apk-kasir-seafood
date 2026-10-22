import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireKasirAccess } from '@/lib/auth'
import { getKasirSessionState } from '@/lib/kasir-session'
import { recordActivity } from '@/lib/activity-log'

// POST /api/kasir/tutup — tutup kasir hari ini
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
    const userId = context!.user.id

    const closedAt = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const state = await getKasirSessionState(tx, warungId, userId, closedAt)
      if (state.isClosed) return { type: 'ALREADY_CLOSED' as const, state }

      const openOrders = await tx.transaksi.findMany({
        where: { warungId, kasirId: userId, status: 'OPEN', createdAt: { gte: state.sessionStart } },
        select: { nomorMeja: true },
      })
      if (openOrders.length > 0) return { type: 'OPEN_ORDERS' as const, openOrders }

      await tx.transaksi.updateMany({
        where: { warungId, kasirId: userId, status: 'OPEN', createdAt: { lt: state.sessionStart } },
        data: { status: 'BATAL' },
      })

      const transaksis = await tx.transaksi.findMany({
        where: { warungId, kasirId: userId, createdAt: { gte: state.sessionStart, lte: closedAt }, status: 'SELESAI' },
        select: { total: true },
      })
      const totalTransaksi = transaksis.length
      const totalPendapatan = transaksis.reduce((sum, t) => sum + t.total, 0)
      const sesi = await tx.kasirSesi.create({
        data: {
          warungId,
          tanggal: state.today,
          dibukaPada: state.sessionStart,
          ditutupOleh: userId,
          ditutupPada: closedAt,
          totalTransaksi,
          totalPendapatan,
        },
      })
      return { type: 'CLOSED' as const, state, sesi, totalTransaksi, totalPendapatan }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.type === 'ALREADY_CLOSED') {
      return NextResponse.json({
        success: false,
        message: `Kasir sudah ditutup pada ${new Date(result.state.latest!.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`,
      }, { status: 409 })
    }
    if (result.type === 'OPEN_ORDERS') {
      const meja = result.openOrders.map((o) => o.nomorMeja).join(', ')
      return NextResponse.json({
        success: false,
        message: `Masih ada pesanan yang belum dibayar di ${meja}. Selesaikan atau hapus pesanan tersebut sebelum tutup kasir.`,
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
        tanggal: result.state.today.toISOString().split('T')[0],
        dibukaPada: result.sesi.dibukaPada,
        ditutupPada: result.sesi.ditutupPada,
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
