import { prisma } from '@/lib/prisma'
import { buildLaporanHarian } from '@/lib/laporan-shift'
import { getStoreDateKey } from '@/lib/time'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import AutoRefresh from '@/components/AutoRefresh'
import LaporanClient from './LaporanClient'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export const metadata = {
  title: `Laporan Harian & Tutup Kasir — ${DEFAULT_BRANCH_NAME}`,
  description: 'Rekapitulasi penjualan harian dan penutupan shift kasir.',
}

export default async function LaporanPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const warungs = await prisma.warung.findMany({
    where: session.role === 'KASIR' ? { id: session.warungId ?? undefined } : undefined,
    orderBy: { nama: 'asc' },
    select: { id: true, nama: true, kode: true },
  })
  const defaultWarung = warungs[0]

  if (!defaultWarung) {
    return (
      <div className="app-container">
        <div className="content-area" style={{ padding: '3rem', textAlign: 'center' }}>
          <p>Warung tidak ditemukan.</p>
        </div>
      </div>
    )
  }

  const laporan = await buildLaporanHarian(prisma, defaultWarung.id, getStoreDateKey())
  const role = session.role === 'OWNER' ? 'OWNER' : 'KASIR'

  return (
    <div className="app-container">
      <AutoRefresh />
      <Navbar
        session={{
          warungNama: defaultWarung.nama,
          warungKode: defaultWarung.kode,
          namaLengkap: session.namaLengkap ?? defaultWarung.nama,
          username: session.username ?? defaultWarung.kode,
          role,
        }}
        activePage="laporan"
      />
      <div className="content-area">
        <LaporanClient
          warungId={defaultWarung.id}
          warungNama={defaultWarung.nama}
          warungs={warungs}
          role={role}
          initialData={laporan}
        />
      </div>
    </div>
  )
}
