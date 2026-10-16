import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { getStoreDayRange } from '@/lib/time'

// GET /api/dashboard — ambil data ringkasan dashboard
export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    
    // Hanya owner yang boleh akses dashboard
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { today, tomorrow } = getStoreDayRange()

    const transaksiHariIniWhere = {
      createdAt: { gte: today, lt: tomorrow },
      status: 'SELESAI' as const,
    }

    const [totalPenjualan, totalTransaksi, jumlahKasir, penjualanPerWarung, topMenu, recentTransaksi] = await Promise.all([
      prisma.transaksi.aggregate({ where: transaksiHariIniWhere, _sum: { total: true } }),
      prisma.transaksi.count({ where: transaksiHariIniWhere }),
      prisma.user.count({ where: { role: 'KASIR', isActive: true } }),
      prisma.transaksi.groupBy({
        by: ['warungId'],
        where: transaksiHariIniWhere,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.transaksiItem.groupBy({
        by: ['menuId'],
        where: { transaksi: { createdAt: { gte: today, lt: tomorrow }, status: 'SELESAI' } },
        _sum: { subtotal: true, qty: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5,
      }),
      prisma.transaksi.findMany({
        where: { status: 'SELESAI' },
        include: { warung: { select: { nama: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    // Ambil nama warung
    const warungIds = penjualanPerWarung.map((w) => w.warungId)
    const warungs = await prisma.warung.findMany({
      where: { id: { in: warungIds } },
    })
    const warungMap = new Map(warungs.map((w) => [w.id, w.nama]))

    const penjualanWarung = penjualanPerWarung.map((item) => ({
      warungId: item.warungId,
      warungNama: warungMap.get(item.warungId) || 'Unknown',
      totalBayar: item._sum?.total || 0,
      jumlahTransaksi: item._count?.id || 0,
    }))

    // Ambil nama menu
    const menuIds = topMenu.map((m) => m.menuId)
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds } },
    })
    const menuMap = new Map(menus.map((m) => [m.id, m.nama]))

    const topMenuWithNames = topMenu.map((item) => ({
      menuId: item.menuId,
      menuNama: menuMap.get(item.menuId) || 'Unknown',
      totalPenjualan: item._sum?.subtotal || 0,
      totalQty: item._sum?.qty || 0,
    }))

    const recentData = recentTransaksi.map((t) => ({
      id: t.id,
      warungNama: t.warung?.nama || 'Unknown',
      totalBayar: t.total,
      createdAt: t.createdAt.toISOString(),
    }))

    return NextResponse.json({
      success: true,
      data: {
        totalPenjualan: totalPenjualan._sum?.total || 0,
        totalTransaksi,
        jumlahKasir,
        penjualanWarung,
        topMenu: topMenuWithNames,
        recentTransaksi: recentData,
      },
    })
  } catch (error) {
    console.error('[GET /api/dashboard]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil data dashboard.' }, { status: 500 })
  }
}
