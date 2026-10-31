import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { isRupiahAmount } from '@/lib/rupiah'
import { recordActivity } from '@/lib/activity-log'
import { apiRateLimiter } from '@/lib/rate-limiter'

const DEFAULT_CATEGORY = 'Lainnya'

// POST /api/kasir/menu - kasir hanya boleh menambah menu baru (nama & harga)
export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json(
        { success: false, message: 'Kasir tidak terdaftar di warung.' },
        { status: 403 },
      )
    }

    const userId = context!.user.id
    const limit = apiRateLimiter.check(`kasir:menu:${warungId}:${userId}`)
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: 'Terlalu banyak request. Coba lagi sebentar.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
      )
    }

    const body = await request.json().catch(() => ({}))
    const nama = typeof body.nama === 'string' ? body.nama.trim() : ''
    const harga = body.harga

    if (!nama) {
      return NextResponse.json(
        { success: false, errors: { nama: 'Nama menu wajib diisi.' } },
        { status: 422 },
      )
    }
    if (nama.length > 100) {
      return NextResponse.json(
        { success: false, errors: { nama: 'Nama menu maksimal 100 karakter.' } },
        { status: 422 },
      )
    }
    if (!isRupiahAmount(harga)) {
      return NextResponse.json(
        { success: false, errors: { harga: 'Harga harus angka bulat positif.' } },
        { status: 422 },
      )
    }

    const existing = await prisma.menu.findFirst({
      where: { warungId, nama: { equals: nama, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, errors: { nama: 'Nama menu sudah ada.' } },
        { status: 422 },
      )
    }

    const category = await prisma.menuCategory.upsert({
      where: { warungId_nama: { warungId, nama: DEFAULT_CATEGORY } },
      update: {},
      create: { warungId, nama: DEFAULT_CATEGORY, sortOrder: 0 },
      select: { id: true },
    })

    const menu = await prisma.menu.create({
      data: {
        warungId,
        categoryId: category.id,
        nama,
        harga,
        isAktif: true,
        sortOrder: 0,
      },
      include: { category: { select: { id: true, nama: true } } },
    })

    try {
      await recordActivity(prisma, {
        userId,
        warungId,
        aktivitas: 'TAMBAH_MENU',
        detail: `Menu "${menu.nama}" seharga Rp ${menu.harga.toLocaleString('id-ID')} ditambahkan dari halaman transaksi`,
      })
    } catch { /* logging tidak boleh menggagalkan penambahan menu */ }

    return NextResponse.json({ success: true, data: menu }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { success: false, errors: { nama: 'Nama menu sudah ada.' } },
        { status: 422 },
      )
    }

    console.error('[POST /api/kasir/menu]', error)
    return NextResponse.json(
      { success: false, message: 'Gagal menambahkan menu.' },
      { status: 500 },
    )
  }
}
