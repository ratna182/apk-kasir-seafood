'use client'

import Link from 'next/link'
import { LayoutDashboard, BarChart3, UtensilsCrossed, Users, Plus, History, User, DollarSign, Activity, Printer } from 'lucide-react'
import LogoutButton from './LogoutButton'

interface NavbarProps {
  session: {
    warungNama: string | null
    warungKode: string | null
    namaLengkap?: string | null
    username: string
    role: string
  }
  activePage?: 'dashboard' | 'transaksi' | 'menu' | 'laporan' | 'riwayat' | 'kasir' | 'harga-warung' | 'activity-log' | 'printer-test'
}

export default function Navbar({ session, activePage }: NavbarProps) {

  return (
    <nav className="navbar no-print">
      <div className="navbar-brand">
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', color: 'inherit' }}>
          <div className="navbar-logo">VJ</div>
          <div>
            <div className="navbar-title">Vian Jaya</div>
            <div className="navbar-subtitle">Seafood &amp; Nasi Uduk</div>
          </div>
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div className="navbar-links" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {session.role === 'OWNER' && (
            <>
              <Link
                href="/dashboard"
                className={`btn btn-sm ${activePage === 'dashboard' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <LayoutDashboard size={14} />
                Dashboard
              </Link>
              <Link
                href="/laporan"
                className={`btn btn-sm ${activePage === 'laporan' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <BarChart3 size={14} />
                Laporan
              </Link>
              <Link
                href="/riwayat"
                className={`btn btn-sm ${activePage === 'riwayat' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <History size={14} />
                Riwayat
              </Link>
              <Link
                href="/menu"
                className={`btn btn-sm ${activePage === 'menu' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <UtensilsCrossed size={14} />
                Menu
              </Link>
              <Link
                href="/kasir"
                className={`btn btn-sm ${activePage === 'kasir' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <Users size={14} />
                Kasir
              </Link>
              <Link
                href="/activity-log"
                className={`btn btn-sm ${activePage === 'activity-log' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <Activity size={14} />
                Log Activity
              </Link>
              <Link
                href="/admin/harga-warung"
                className={`btn btn-sm ${activePage === 'harga-warung' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <DollarSign size={14} />
                Harga
              </Link>
            </>
          )}
          
          {session.role === 'KASIR' && (
            <>
              <Link
                href="/transaksi"
                className={`btn btn-sm ${activePage === 'transaksi' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <Plus size={14} />
                Transaksi
              </Link>
              <Link
                href="/laporan"
                className={`btn btn-sm ${activePage === 'laporan' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <BarChart3 size={14} />
                Laporan
              </Link>
              <Link
                href="/riwayat"
                className={`btn btn-sm ${activePage === 'riwayat' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              >
                <History size={14} />
                Riwayat
              </Link>
            </>
          )}
          <Link
            href="/printer-test"
            className={`btn btn-sm ${activePage === 'printer-test' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          >
            <Printer size={14} />
            Printer Test
          </Link>
        </div>

        <div className="navbar-actions" style={{ marginLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/profil"
            className="navbar-user text-sm text-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none', cursor: 'pointer' }}
          >
            <User size={14} />
            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.namaLengkap || session.username}
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </nav>
  )
}
