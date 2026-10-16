import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getKasirSessionState } from '@/lib/kasir-session'
import { getStoreDayRange } from '@/lib/time'
import Navbar from '@/components/Navbar'
import AutoRefresh from '@/components/AutoRefresh'
import Link from 'next/link'
import { BarChart3, UtensilsCrossed, Users, ClipboardList, ScrollText, Plus } from 'lucide-react'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const { today, tomorrow } = getStoreDayRange()

  const now = new Date()
  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (session.role === 'OWNER') {
    const [totalPenjualan, totalTransaksi, jumlahKasir, jumlahWarung, penjualanPerWarung, topMenu, warungs, menus] = await Promise.all([
      prisma.transaksi.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'SELESAI' },
        _sum: { total: true },
      }),
      prisma.transaksi.count({
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'SELESAI' },
      }),
      prisma.user.count({ where: { role: 'KASIR', isActive: true } }),
      prisma.warung.count(),
      prisma.transaksi.groupBy({
        by: ['warungId'],
        where: { createdAt: { gte: today, lt: tomorrow }, status: 'SELESAI' },
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
      prisma.warung.findMany({ select: { id: true, nama: true } }),
      prisma.menu.findMany({ where: { isAktif: true }, select: { id: true, nama: true } }),
    ])

    const warungMap = new Map(warungs.map((w) => [w.id, w.nama]))
    const menuMap = new Map(menus.map((m) => [m.id, m.nama]))

    const penjualanWarung = penjualanPerWarung.map((item) => ({
      warungNama: warungMap.get(item.warungId) || 'Unknown',
      totalBayar: item._sum?.total || 0,
      jumlahTransaksi: item._count?.id || 0,
    }))

    const topMenuWithNames = topMenu.map((item) => ({
      menuNama: menuMap.get(item.menuId) || 'Unknown',
      totalPenjualan: item._sum?.subtotal || 0,
      totalQty: item._sum?.qty || 0,
    }))

    return (
      <div className="app-container">
        <AutoRefresh />
        <Navbar session={session} activePage="dashboard" />
        <div className="content-area">
          <div style={{ marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Dashboard</h1>
            <p className="text-secondary text-sm">{dateStr}</p>
          </div>

          {/* Stats — Hierarki: Total Penjualan dominan */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
              <div className="text-muted text-xs" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Total Penjualan Hari Ini</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif", lineHeight: 1 }}>
                Rp {(totalPenjualan._sum?.total || 0).toLocaleString('id-ID')}
              </div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>
                {totalTransaksi}
              </div>
              <div className="text-muted text-xs">Transaksi</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>
                {jumlahKasir}
              </div>
              <div className="text-muted text-xs">Kasir Aktif</div>
            </div>
          </div>

          {/* Penjualan Per Warung */}
          {penjualanWarung.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
                Penjualan Per Warung Hari Ini
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                {penjualanWarung.map((item, index) => (
                  <div key={index} className="card">
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-primary)' }}>{item.warungNama}</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-brand)', fontFamily: "var(--font-fraunces), serif" }}>
                      Rp {item.totalBayar.toLocaleString('id-ID')}
                    </div>
                    <div className="text-sm text-muted">{item.jumlahTransaksi} transaksi</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Menu */}
          {topMenuWithNames.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
                Menu Terlaris Hari Ini
              </h2>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Menu</th>
                      <th>Terjual</th>
                      <th>Total Penjualan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMenuWithNames.map((item, index) => (
                      <tr key={index}>
                        <td>#{index + 1}</td>
                        <td><strong>{item.menuNama}</strong></td>
                        <td>{item.totalQty} porsi</td>
                        <td>Rp {item.totalPenjualan.toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Akses Cepat — Title case, bukan all-caps */}
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
            Akses Cepat
          </h2>
          <div className="dashboard-grid">
            <Link href="/laporan" className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--color-success-light)' }}>
                <BarChart3 size={22} color="var(--color-success)" />
              </div>
              <div className="stat-card-info">
                <h3>Laporan</h3>
                <p>Rekap penjualan & export</p>
              </div>
            </Link>
            <Link href="/menu" className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--color-brand-light)' }}>
                <UtensilsCrossed size={22} color="var(--color-brand)" />
              </div>
              <div className="stat-card-info">
                <h3>Kelola Menu</h3>
                <p>Tambah, edit, atur menu</p>
              </div>
            </Link>
            <Link href="/kasir" className="stat-card">
              <div className="stat-card-icon" style={{ background: 'var(--color-pending-light)' }}>
                <Users size={22} color="var(--color-pending)" />
              </div>
              <div className="stat-card-info">
                <h3>Manajemen Kasir</h3>
                <p>Kelola akun kasir</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Dashboard KASIR
  const warungId = session.warungId as string

  const kasirState = await getKasirSessionState(prisma, warungId, session.id)
  const [jumlahTransaksiHariIni, totalPendapatan] = kasirState.isClosed
    ? [kasirState.latest!.totalTransaksi, kasirState.latest!.totalPendapatan]
    : await Promise.all([
        prisma.transaksi.count({
          where: { warungId, kasirId: session.id, createdAt: { gte: kasirState.sessionStart }, status: 'SELESAI' },
        }),
        prisma.transaksi.aggregate({
          where: { warungId, kasirId: session.id, createdAt: { gte: kasirState.sessionStart }, status: 'SELESAI' },
          _sum: { total: true },
        }).then((result) => result._sum.total || 0),
      ])

  const sudahTutup = kasirState.isClosed
  const kasirSesi = kasirState.latest

  return (
    <div className="app-container">
      <Navbar session={session} activePage="dashboard" />
      <div className="content-area">
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Dashboard</h1>
          <p className="text-secondary text-sm">{dateStr}</p>
        </div>

        {sudahTutup ? (
          <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Kasir Sudah Ditutup</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                Ditutup pada {new Date(kasirSesi!.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.
                Transaksi baru dapat dibuat mulai besok.
              </p>
            </div>
          </div>
        ) : (
          <div className="alert alert-success" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Kasir Buka</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>Siap menerima pesanan.</p>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>
              {jumlahTransaksiHariIni}
            </div>
            <div className="text-muted text-xs">Transaksi Hari Ini</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif" }}>
              Rp {totalPendapatan.toLocaleString('id-ID')}
            </div>
            <div className="text-muted text-xs">Pendapatan Hari Ini</div>
          </div>
        </div>

        <h2 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          Menu Utama
        </h2>
        <div className="dashboard-grid">
          <Link
            href="/transaksi"
            id="btn-transaksi-baru"
            className="stat-card"
            style={{
              pointerEvents: sudahTutup ? 'none' : 'auto',
              opacity: sudahTutup ? 0.5 : 1,
            }}
          >
            <div className="stat-card-icon" style={{ background: 'var(--color-brand-light)' }}>
              <Plus size={22} color="var(--color-brand)" />
            </div>
            <div className="stat-card-info">
              <h3>Transaksi Baru</h3>
              <p>{sudahTutup ? 'Kasir sudah ditutup' : 'Catat pesanan tamu'}</p>
            </div>
          </Link>
          <Link href="/riwayat" id="btn-riwayat" className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-pending-light)' }}>
              <ScrollText size={22} color="var(--color-pending)" />
            </div>
            <div className="stat-card-info">
              <h3>Riwayat Transaksi</h3>
              <p>Daftar transaksi hari ini</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
