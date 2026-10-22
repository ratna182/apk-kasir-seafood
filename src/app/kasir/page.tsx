import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Navbar from '@/components/Navbar'
import KasirManager from './KasirManager'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export const metadata = {
  title: `Manajemen Kasir — ${DEFAULT_BRANCH_NAME}`,
  description: 'Kelola akun kasir untuk setiap outlet.',
}

export default async function KasirPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  
  // Semua role bisa akses halaman ini
  const warungs = await prisma.warung.findMany({
    orderBy: { nama: 'asc' },
  })

  return (
    <div className="app-container">
      <Navbar session={session} activePage="kasir" />
      <div className="content-area">
        <KasirManager warungs={warungs} userRole={session.role} />
      </div>
    </div>
  )
}
