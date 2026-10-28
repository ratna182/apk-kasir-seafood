import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getKasirSessionState, isShiftOvertime, shiftDurationHours, personName } from '@/lib/kasir-shift'
import { formatWibDateTime, formatWibShiftRange, getStoreDayRange } from '@/lib/time'
import Navbar from '@/components/Navbar'
import AutoRefresh from '@/components/AutoRefresh'
import ForceCloseShift, { type OpenShiftInfo } from '@/components/ForceCloseShift'
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
    timeZone: 'Asia/Jakarta',
  })

  if (session.role === 'OWNER') {
    const todayShifts = await prisma.kasirShift.findMany({
      where: { dibukaPada: { gte: today, lt: tomorrow } },
      select: { id: true, warungId: true },
    })
    const shiftIds = todayShifts.map((shift) => shift.id)
    const scope = {
      status: 'SELESAI' as const,
      OR: [
        ...(shiftIds.length > 0 ? [{ shiftId: { in: shiftIds } }] : []),
        { shiftId: null, createdAt: { gte: today, lt: tomorrow } },
      ],
    }

    const [totalPenjualan, totalTransaksi, jumlahKasir, penjualanPerWarung, topMenu, warungs, menus, openShiftsRaw] = await Promise.all([
      prisma.transaksi.aggregate({
        where: scope,
        _sum: { total: true },
      }),
      prisma.transaksi.count({ where: scope }),
      prisma.user.count({ where: { role: 'KASIR', isActive: true } }),
      prisma.transaksi.groupBy({
        by: ['warungId'],
        where: scope,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.transaksiItem.groupBy({
        by: ['menuId'],
        where: { transaksi: scope },
        _sum: { subtotal: true, qty: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5,
      }),
      prisma.warung.findMany({ select: { id: true, nama: true } }),
      prisma.menu.findMany({ where: { isAktif: true }, select: { id: true, nama: true } }),
      prisma.kasirShift.findMany({
        where: { status: 'TERBUKA' },
        include: {
          warung: { select: { nama: true } },
          pembuka: { select: { namaLengkap: true, username: true } },
          transaksis: { where: { status: 'SELESAI' }, select: { total: true } },
        },
        orderBy: [{ dibukaPada: 'asc' }, { createdAt: 'asc' }],
      }),
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

    const openShifts: OpenShiftInfo[] = openShiftsRaw.map((shift) => ({
      id: shift.id,
      warungId: shift.warungId,
      warungNama: shift.warung.nama,
      dibukaPada: shift.dibukaPada?.toISOString() ?? null,
      dibukaOleh: personName(shift.pembuka),
      durationHours: shiftDurationHours(shift, now),
      overtime: isShiftOvertime(shift, now),
      totalTransaksi: shift.transaksis.length,
      totalPendapatan: shift.transaksis.reduce((sum, transaksi) => sum + transaksi.total, 0),
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

          <ForceCloseShift shifts={openShifts} />

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
              <div className="text-muted text-xs" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Total Penjualan Shift Hari Ini</div>
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

          {penjualanWarung.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
                Penjualan Per Warung (Shift Hari Ini)
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

          {topMenuWithNames.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
                Menu Terlaris Shift Hari Ini
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
                <p>Rekap per shift & export</p>
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

  const warungId = session.warungId as string
  const kasirState = await getKasirSessionState(prisma, warungId)
  const openShift = kasirState.shift
  const latestShift = kasirState.latest
  const sudahTutup = kasirState.isClosed
  const totalTransaksi = latestShift?.totalTransaksi ?? 0
  const totalPendapatan = latestShift?.totalPendapatan ?? 0
  const overtime = kasirState.overtime
  const durationHours = kasirState.durationHours

  return (
    <div className="app-container">
      <Navbar session={session} activePage="dashboard" />
      <div className="content-area">
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Dashboard</h1>
          <p className="text-secondary text-sm">{dateStr}</p>
        </div>

        {overtime && (
          <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Peringatan: shift sudah berjalan lebih dari 18 jam</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                Minta owner menutup paksa shift atau segera tutup shift setelah pesanan selesai.
              </p>
            </div>
          </div>
        )}

        {openShift ? (
          <div className="alert alert-success" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Kasir Buka</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                Buka {formatWibDateTime(openShift.dibukaPada)} WIB oleh {openShift.dibukaOleh}. Siap menerima pesanan.
              </p>
            </div>
          </div>
        ) : latestShift ? (
          <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Shift Terakhir Sudah Ditutup</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>
                {formatWibShiftRange(latestShift.dibukaPada, latestShift.ditutupPada)}.
                Buka shift baru untuk mulai bertransaksi lagi.
              </p>
            </div>
          </div>
        ) : (
          <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Belum Ada Shift</strong>
              <p style={{ margin: 0, fontSize: '0.8rem' }}>Buka kasir terlebih dahulu sebelum mencatat transaksi.</p>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>
              {totalTransaksi}
            </div>
            <div className="text-muted text-xs">Transaksi Shift Ini</div>
          </div>
          <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif" }}>
              Rp {totalPendapatan.toLocaleString('id-ID')}
            </div>
            <div className="text-muted text-xs">Pendapatan Shift Ini</div>
          </div>
        </div>

        {openShift && (
          <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '2rem' }}>
            <div className="text-sm text-secondary">Durasi shift</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: overtime ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
              {Math.floor(durationHours)}j {Math.floor((durationHours % 1) * 60)}m {overtime ? '• OVERTIME' : ''}
            </div>
          </div>
        )}

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
              <p>{sudahTutup ? 'Buka kasir terlebih dahulu' : 'Catat pesanan tamu'}</p>
            </div>
          </Link>
          <Link href="/riwayat" id="btn-riwayat" className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-pending-light)' }}>
              <ScrollText size={22} color="var(--color-pending)" />
            </div>
            <div className="stat-card-info">
              <h3>Riwayat Transaksi</h3>
              <p>Daftar transaksi shift ini</p>
            </div>
          </Link>
          <Link href="/laporan" className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-success-light)' }}>
              <ClipboardList size={22} color="var(--color-success)" />
            </div>
            <div className="stat-card-info">
              <h3>Laporan Shift</h3>
              <p>Rekap penjualan per shift</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
