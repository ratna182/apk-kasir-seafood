export { getKasirSessionState } from './kasir-shift'

import { getStoreDayRange } from './time'

export function getTodayRange(now = new Date()) {
  return getStoreDayRange(now)
}
