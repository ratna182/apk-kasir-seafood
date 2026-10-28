import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'
import { getStoreDayRange } from '@/lib/time'
import { VALID_TABLE_NAMES } from '@/lib/table-layout'

type IncomingItem = {
  menuId: string
  qty: number
  hargaSatuan?: number
  diskonSatuan?: number
  catatan?: string
}

function isUniqueOpenOrderError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// POST /api/transaksi - buat/append order sementara (kasir only)
export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }

    const body = await request.json()
    const nomorMeja = body.nomorMeja?.toString().trim()
    const items = body.items as IncomingItem[] | undefined

    if (!nomorMeja) {
      return NextResponse.json({ success: false, message: 'Nomor meja wajib diisi.' }, { status: 422 })
    }
    const kasirId = context!.user.id

    if (!VALID_TABLE_NAMES.has(nomorMeja)) {
      return NextResponse.json({ success: false, message: 'Nomor meja harus Meja 1-15, Lesehan 1-11, atau Bungkus.' }, { status: 422 })
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, message: 'Tambahkan minimal 1 item pesanan.' }, { status: 422 })
    }

    for (const item of items) {
      const qty = Number(item.qty)
      if (!item.menuId || !Number.isInteger(qty) || qty < 1) {
        return NextResponse.json({ success: false, message: 'Qty harus minimal 1.' }, { status: 422 })
      }
      if ((item.hargaSatuan !== undefined && (!Number.isInteger(Number(item.hargaSatuan)) || Number(item.hargaSatuan) < 0)) ||
        (item.diskonSatuan !== undefined && (!Number.isInteger(Number(item.diskonSatuan)) || Number(item.diskonSatuan) < 0)) ||
        (item.catatan !== undefined && (typeof item.catatan !== 'string' || item.catatan.length > 160))) {
        return NextResponse.json({ success: false, message: 'Penyesuaian item tidak valid.' }, { status: 422 })
      }
    }

    const menuIds = [...new Set(items.map((item) => item.menuId))]
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds }, warungId, isAktif: true },
      include: { warungMenus: { where: { warungId }, select: { harga: true } } },
    })

    if (menus.length !== menuIds.length) {
      return NextResponse.json({
        success: false,
        message: 'Beberapa menu tidak valid atau sudah tidak aktif.',
      }, { status: 422 })
    }

    const menusById = new Map(menus.map((menu) => [menu.id, menu]))
    const processedItems: Array<{ menuId: string; namaMenu: string; hargaSatuan: number; diskonSatuan: number; catatan: string | null; qty: number; subtotal: number }> = []
    for (const item of items) {
      const menu = menusById.get(item.menuId)!
      const qty = Number(item.qty)
      const effectiveHarga = menu.warungMenus[0]?.harga ?? menu.harga
      const hargaSatuan = item.hargaSatuan === undefined ? effectiveHarga : Number(item.hargaSatuan)
      const diskonSatuan = Number(item.diskonSatuan || 0)
      const catatan = item.catatan?.trim() || null
      if (diskonSatuan > hargaSatuan) {
        return NextResponse.json({ success: false, message: 'Diskon tidak boleh melebihi harga satuan.' }, { status: 422 })
      }
      processedItems.push({
        menuId: menu.id,
        namaMenu: menu.nama,
        hargaSatuan,
        diskonSatuan,
        catatan,
        qty,
        subtotal: (hargaSatuan - diskonSatuan) * qty,
      })
    }
    const addedTotal = processedItems.reduce((sum, item) => sum + item.subtotal, 0)

    const transaksi = await prisma.$transaction(async (tx) => {
      const shift = await getOpenShift(tx, warungId)
      if (!shift) return 'CLOSED' as const

      const existing = await tx.transaksi.findFirst({
        where: { warungId, nomorMeja, status: 'OPEN', shiftId: shift.id },
      })

      if (!existing) {
        return tx.transaksi.create({
          data: {
            warungId,
            kasirId,
            shiftId: shift.id,
            nomorMeja,
            status: 'OPEN',
            total: addedTotal,
            tanggal: getStoreDayRange(shift.dibukaPada ?? new Date()).today,
            items: { create: processedItems },
          },
          include: { items: { orderBy: { createdAt: 'asc' } } },
        })
      }

      await tx.transaksiItem.createMany({
        data: processedItems.map((item) => ({ ...item, transaksiId: existing.id })),
      })

      return tx.transaksi.update({
        where: { id: existing.id },
        data: { total: existing.total + addedTotal },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (transaksi === 'CLOSED') {
      return NextResponse.json({
        success: false,
        message: 'Buka kasir terlebih dahulu.',
      }, { status: 409 })
    }

    return NextResponse.json({ success: true, data: transaksi }, { status: 201 })
  } catch (error) {
    if (isUniqueOpenOrderError(error)) {
      return NextResponse.json({
        success: false,
        message: 'Meja ini sudah ada order aktif, refresh dan lanjutkan order yang sudah ada.',
      }, { status: 409 })
    }

    console.error('[POST /api/transaksi]', error)
    return NextResponse.json({
      success: false,
      message: 'Gagal menyimpan pesanan. Silakan coba lagi.',
    }, { status: 500 })
  }
}

// GET /api/transaksi - daftar transaksi selesai hari ini (kasir only)
export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }
    const shift = await getOpenShift(prisma, warungId)
    if (!shift) {
      return NextResponse.json({ success: true, data: [] })
    }

    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        shiftId: shift.id,
        status: 'SELESAI',
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: transaksis })
  } catch (error) {
    console.error('[GET /api/transaksi]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil transaksi.' }, { status: 500 })
  }
}
