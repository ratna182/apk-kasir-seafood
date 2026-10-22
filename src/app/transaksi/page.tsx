import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getKasirSessionState } from '@/lib/kasir-session'
import Navbar from '@/components/Navbar'
import TransaksiClient from './TransaksiClient'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export const metadata = {
  title: `Buat Transaksi — ${DEFAULT_BRANCH_NAME}`,
  description: 'Catat pesanan tamu, hitung total, dan cetak struk thermal 80mm.',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function TransaksiPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  
  const ownerWarung = session.role === 'OWNER'
    ? await prisma.warung.findUnique({ where: { kode: 'VJ08-1' }, select: { id: true, nama: true, kode: true, alamat: true } })
    : null
  const activeSession = ownerWarung
    ? { ...session, warungId: ownerWarung.id, warungNama: ownerWarung.nama, warungKode: ownerWarung.kode, warungAlamat: ownerWarung.alamat }
    : session

  if (!activeSession.warungId) redirect('/login')

  const warung = !ownerWarung ? await prisma.warung.findUnique({ where: { id: activeSession.warungId }, select: { alamat: true } }) : null
  const warungAlamat = ownerWarung?.alamat ?? warung?.alamat ?? null

  const kasirState = await getKasirSessionState(prisma, activeSession.warungId, activeSession.id)

  const [menus, warungMenus, activeOrders] = await Promise.all([
    prisma.menu.findMany({
      where: { warungId: activeSession.warungId, isAktif: true },
      include: { category: { select: { id: true, nama: true } } },
      orderBy: [{ sortOrder: 'asc' }, { nama: 'asc' }],
    }),
    prisma.warungMenu.findMany({
      where: { warungId: activeSession.warungId },
      select: { menuId: true, harga: true },
    }),
    prisma.transaksi.findMany({
      where: {
        warungId: activeSession.warungId,
        kasirId: activeSession.id,
        status: 'OPEN',
        createdAt: { gte: kasirState.sessionStart },
      },
      select: {
        id: true,
        nomorMeja: true,
        total: true,
        metodePembayaran: true,
        tanggal: true,
        createdAt: true,
        updatedAt: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, namaMenu: true, hargaSatuan: true, diskonSatuan: true, catatan: true, qty: true, subtotal: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const warungHargaMap = new Map(warungMenus.map((wm) => [wm.menuId, wm.harga]))

  const serializedMenus = menus.map((m) => ({
    id: m.id,
    nama: m.nama,
    harga: warungHargaMap.get(m.id) ?? m.harga,
    isAktif: m.isAktif,
    categoryId: m.categoryId,
    category: m.category,
  }))

  const serializedActiveOrders = (kasirState.isClosed ? [] : activeOrders).map((order) => ({
    id: order.id,
    nomorMeja: order.nomorMeja,
    total: order.total,
    metodePembayaran: order.metodePembayaran,
    tanggal: order.tanggal.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    minutesOpen: 0,
    items: order.items.map((item) => ({
      id: item.id,
      namaMenu: item.namaMenu,
      hargaSatuan: item.hargaSatuan,
      diskonSatuan: item.diskonSatuan,
      catatan: item.catatan,
      qty: item.qty,
      subtotal: item.subtotal,
    })),
  }))

  return (
    <div className="app-container">
      <Navbar session={session} activePage="transaksi" />
      <div className="content-area">
        <TransaksiClient
          session={{ ...activeSession, warungAlamat }}
          menus={serializedMenus}
          initialActiveOrders={serializedActiveOrders}
          isKasirClosed={kasirState.isClosed}
        />
      </div>
    </div>
  )
}
