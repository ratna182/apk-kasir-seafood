'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-renders the server component behind the page on a timer, so a report the cashier just closed
 * shows up for the owner without a manual reload.
 */
export default function AutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])

  return null
}