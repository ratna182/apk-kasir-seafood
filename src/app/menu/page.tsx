import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import Navbar from '@/components/Navbar'
import MenuManager from './MenuManager'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export const metadata = {
  title: `Kelola Menu — ${DEFAULT_BRANCH_NAME}`,
  description: 'Manajemen daftar menu, harga, dan ketersediaan menu warung.',
}

export default async function MenuPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  
  // Hanya owner yang boleh akses halaman ini
  if (session.role !== 'OWNER') {
    redirect('/transaksi')
  }

  return (
    <div className="app-container">
      <Navbar session={session} activePage="menu" />
      <div className="content-area">
        <MenuManager />
      </div>
    </div>
  )
}
