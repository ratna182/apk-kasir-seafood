import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireKasirAccess } from '@/lib/auth'
import { getKasirSessionState } from '@/lib/kasir-session'
import { recordActivity } from '@/lib/activity-log'

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

    const openedAt = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const state = await getKasirSessionState(tx, warungId, userId, openedAt)
      if (state.latest && state.isClosed) {
        const updated = await tx.kasirSesi.updateMany({
          where: { id: state.latest.id, dibukaKembaliPada: null },
          data: { dibukaPada: openedAt, dibukaKembaliPada: openedAt },
        })
        return updated.count === 1 ? 'REOPENED' : 'ALREADY_OPEN'
      }
      if (state.latest) return 'ALREADY_OPEN'

      await tx.kasirSesi.create({
        data: {
          warungId,
          tanggal: state.today,
          dibukaPada: openedAt,
          dibukaKembaliPada: openedAt,
          ditutupOleh: userId,
          totalTransaksi: 0,
          totalPendapatan: 0,
        },
      })
      return 'OPENED'
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result === 'ALREADY_OPEN') {
      return NextResponse.json({
        success: false,
        message: 'Kasir hari ini sudah terbuka.',
      }, { status: 409 })
    }

    try {
      await recordActivity(prisma, {
        userId,
        warungId,
        aktivitas: 'BUKA_KASIR',
        detail: result === 'REOPENED' ? 'Sesi kasir dibuka kembali' : 'Sesi kasir baru dibuka',
      })
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      message: result === 'REOPENED' ? 'Kasir berhasil dibuka kembali.' : 'Kasir berhasil dibuka dengan sesi transaksi baru.',
      data: { dibukaPada: openedAt },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ success: false, message: 'Status kasir baru saja berubah. Silakan coba lagi.' }, { status: 409 })
    }
    console.error('[POST /api/kasir/buka]', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, message: `Gagal membuka kasir: ${msg}` }, { status: 500 })
  }
}
