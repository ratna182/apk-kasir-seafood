import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import Navbar from '@/components/Navbar'
import ActivityLogClient from './ActivityLogClient'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export const metadata = {
  title: `Realtime Log Activity — ${DEFAULT_BRANCH_NAME}`,
}

export default async function ActivityLogPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'OWNER') redirect('/transaksi')

  return (
    <div className="app-container">
      <Navbar session={session} activePage="activity-log" />
      <div className="content-area">
        <ActivityLogClient />
      </div>
    </div>
  )
}
