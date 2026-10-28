import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireKasirAccess } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'
import { recordActivity } from '@/lib/activity-log'
import { apiRateLimiter } from '@/lib/rate-limiter'

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

    const rateLimitKey = `kasir:buka:${warungId}:${context!.user.id}`
    const { allowed } = apiRateLimiter.check(rateLimitKey)
    if (!allowed) {
      return NextResponse.json({ success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' }, { status: 429 })
    }

    const userId = context!.user.id
    const catatan = typeof body.catatan === 'string' ? body.catatan.trim().slice(0, 500) || null : null
    const openedAt = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const open = await getOpenShift(tx, warungId)
      if (open) return { type: 'ALREADY_OPEN' as const, open }

      const shift = await tx.kasirShift.create({
        data: {
          warungId,
          dibukaOleh: userId,
          dibukaPada: openedAt,
          status: 'TERBUKA',
          catatanBuka: catatan,
        },
      })
      await tx.kasirShiftEvent.create({
        data: {
          shiftId: shift.id,
          warungId,
          userId,
          jenis: 'BUKA',
          waktu: openedAt,
          catatan,
        },
      })
      return { type: 'OPENED' as const, shift }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.type === 'ALREADY_OPEN') {
      return NextResponse.json({
        success: false,
        message: 'Kasir masih terbuka. Tutup shift yang sedang berjalan terlebih dahulu sebelum membuka shift baru.',
        data: { shiftId: result.open.id, dibukaPada: result.open.dibukaPada },
      }, { status: 409 })
    }

    try {
      await recordActivity(prisma, {
        userId,
        warungId,
        aktivitas: 'BUKA_KASIR',
        detail: 'Shift kasir baru dibuka',
      })
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      message: 'Kasir berhasil dibuka.',
      data: { shiftId: result.shift.id, dibukaPada: openedAt },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) {
      return NextResponse.json({ success: false, message: 'Kasir masih terbuka atau status baru saja berubah. Silakan coba lagi.' }, { status: 409 })
    }
    console.error('[POST /api/kasir/buka]', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, message: `Gagal membuka kasir: ${msg}` }, { status: 500 })
  }
}
