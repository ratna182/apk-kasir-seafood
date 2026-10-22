export function compareIndonesian(a: string, b: string): number {
  return a.localeCompare(b, 'id', { sensitivity: 'base' })
}

export function sortByName<T extends { nama: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareIndonesian(a.nama, b.nama))
}
