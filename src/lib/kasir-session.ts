import type { Prisma } from '@prisma/client'
import { getStoreDayRange } from './time'

type KasirSessionDb = Pick<Prisma.TransactionClient, 'kasirSesi'>

export function getTodayRange(now = new Date()) {
  return getStoreDayRange(now)
}

export async function getKasirSessionState(db: KasirSessionDb, warungId: string, kasirId: string, now = new Date()) {
  const { today, tomorrow } = getStoreDayRange(now)
  const latest = await db.kasirSesi.findFirst({
    where: { warungId, ditutupOleh: kasirId, tanggal: today },
    orderBy: { ditutupPada: 'desc' },
  })
  const isClosed = Boolean(latest && !latest.dibukaKembaliPada)
  const previous = isClosed && latest
    ? await db.kasirSesi.findFirst({
        where: { warungId, ditutupOleh: kasirId, tanggal: today, ditutupPada: { lt: latest.ditutupPada } },
        orderBy: { ditutupPada: 'desc' },
      })
    : null

  return {
    today,
    tomorrow,
    latest,
    isClosed,
    // The daily report always covers the whole store day. Starting at the last reopening would
    // drop every sale made before the cashier opened the shift again.
    dayStart: today,
    dayEnd: tomorrow,
    // The closed-cycle export instead covers one shift, from the reopening to the close.
    sessionStart: latest?.dibukaKembaliPada ?? previous?.dibukaKembaliPada ?? today,
    sessionEnd: isClosed ? latest!.ditutupPada : now,
  }
}