import type { Prisma } from '@prisma/client'
import { getStoreDayRange } from './time'

export const SHIFT_WARNING_HOURS = 18
export const SHIFT_WARNING_MS = SHIFT_WARNING_HOURS * 60 * 60 * 1000

export type ShiftDb = Pick<Prisma.TransactionClient, 'kasirShift' | 'kasirShiftEvent' | 'transaksi'>

export interface ShiftPerson {
  namaLengkap: string | null
  username: string
}

export interface ShiftSummary {
  id: string
  warungId: string
  status: 'TERBUKA' | 'DITUTUP'
  dibukaPada: Date | null
  ditutupPada: Date | null
  dibukaOleh: string
  ditutupOleh: string | null
  catatanBuka: string | null
  catatanTutup: string | null
  pembuka?: ShiftPerson | null
  penutup?: ShiftPerson | null
  totalTransaksi: number
  totalPendapatan: number
}

interface ShiftRow {
  id: string
  warungId: string
  status: 'TERBUKA' | 'DITUTUP'
  dibukaPada: Date | null
  ditutupPada: Date | null
  dibukaOleh: string
  ditutupOleh: string | null
  catatanBuka: string | null
  catatanTutup: string | null
  pembuka?: ShiftPerson | null
  penutup?: ShiftPerson | null
  transaksis?: Array<{ total: number }>
}

const SHIFT_INCLUDE = {
  pembuka: { select: { namaLengkap: true, username: true } },
  penutup: { select: { namaLengkap: true, username: true } },
  transaksis: { where: { status: 'SELESAI' as const }, select: { total: true } },
} as const

export function toShiftSummary(row: ShiftRow): ShiftSummary {
  return {
    id: row.id,
    warungId: row.warungId,
    status: row.status,
    dibukaPada: row.dibukaPada,
    ditutupPada: row.ditutupPada,
    dibukaOleh: row.dibukaOleh,
    ditutupOleh: row.ditutupOleh,
    catatanBuka: row.catatanBuka,
    catatanTutup: row.catatanTutup,
    pembuka: row.pembuka,
    penutup: row.penutup,
    totalTransaksi: row.transaksis?.length ?? 0,
    totalPendapatan: row.transaksis?.reduce((sum, transaksi) => sum + transaksi.total, 0) ?? 0,
  }
}

export function personName(person: ShiftPerson | null | undefined): string {
  return person?.namaLengkap || person?.username || '-'
}

export function shiftDurationHours(shift: { dibukaPada: Date | null; ditutupPada?: Date | null }, now = new Date()): number {
  if (!shift.dibukaPada) return 0
  const end = shift.ditutupPada ?? now
  return Math.max(0, (end.getTime() - shift.dibukaPada.getTime()) / 3_600_000)
}

export function isShiftOvertime(
  shift: { dibukaPada: Date | null; ditutupPada?: Date | null } | null | undefined,
  now = new Date(),
): boolean {
  if (!shift || shift.ditutupPada) return false
  return shiftDurationHours(shift, now) >= SHIFT_WARNING_HOURS
}

export async function getOpenShift(db: ShiftDb, warungId: string) {
  return db.kasirShift.findFirst({
    where: { warungId, status: 'TERBUKA' },
    include: SHIFT_INCLUDE,
    orderBy: [{ dibukaPada: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getLatestShift(db: ShiftDb, warungId: string) {
  return db.kasirShift.findFirst({
    where: { warungId },
    include: SHIFT_INCLUDE,
    orderBy: [{ dibukaPada: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getKasirSessionState(
  db: ShiftDb,
  warungId: string,
  _kasirId?: string,
  now = new Date(),
) {
  const { today, tomorrow } = getStoreDayRange(now)
  const openShift = await getOpenShift(db, warungId)
  const latestRaw = openShift ?? await getLatestShift(db, warungId)
  const latest = latestRaw ? toShiftSummary(latestRaw) : null
  const open = openShift ? toShiftSummary(openShift) : null
  const isClosed = !open
  const durationHours = open ? shiftDurationHours(open, now) : 0
  const overtime = Boolean(open && durationHours >= SHIFT_WARNING_HOURS)

  return {
    today,
    tomorrow,
    latest,
    shift: open,
    openShift: open,
    isClosed,
    dayStart: today,
    dayEnd: tomorrow,
    sessionStart: open?.dibukaPada ?? latest?.dibukaPada ?? today,
    sessionEnd: isClosed ? latest?.ditutupPada ?? now : now,
    durationHours,
    overtime,
    warningHours: SHIFT_WARNING_HOURS,
  }
}
