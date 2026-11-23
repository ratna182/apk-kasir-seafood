import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const envModule = path.join(root, '.open-next', 'cloudflare', 'next-env.mjs')
const buildEnvFile = path.join(root, '.open-next', 'server-functions', 'default', '.env')

if (!fs.existsSync(envModule)) {
  console.error('[scrub-env] .open-next/cloudflare/next-env.mjs tidak ditemukan. Jalankan build Cloudflare dulu.')
  process.exit(1)
}

const allowed = (key) => key.startsWith('NEXT_PUBLIC_')
const removed = []

const source = fs.readFileSync(envModule, 'utf8')
const output = source
  .split('\n')
  .map((line) => {
    const match = line.match(/^(export const (?:production|development|test) = )(\{.*\});$/)
    if (!match) return line

    const parsed = JSON.parse(match[2])
    const filtered = {}

    for (const [key, value] of Object.entries(parsed)) {
      if (allowed(key)) {
        filtered[key] = value
      } else {
        removed.push(key)
      }
    }

    return `${match[1]}${JSON.stringify(filtered)};`
  })
  .join('\n')

fs.writeFileSync(envModule, output)

if (fs.existsSync(buildEnvFile)) {
  fs.rmSync(buildEnvFile)
}

const unique = [...new Set(removed)]
console.log(
  unique.length > 0
    ? `[scrub-env] Variabel build dibersihkan: ${unique.join(', ')}`
    : '[scrub-env] Tidak ada variabel yang perlu dibersihkan.'
)
