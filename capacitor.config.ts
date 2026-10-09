import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://kasir-seafood.vercel.app'

if (serverUrl && !/^https:\/\//.test(serverUrl)) {
  throw new Error('CAPACITOR_SERVER_URL harus menggunakan HTTPS')
}

const config: CapacitorConfig = {
  appId: process.env.CAPACITOR_APP_ID || 'id.vianjaya.kasir.cabang1',
  appName: process.env.CAPACITOR_APP_NAME || 'Kasir Vian Jaya 08',
  webDir: 'www',
  server: serverUrl ? { url: serverUrl, androidScheme: 'https', allowNavigation: ['kasir-seafood.vercel.app'] } : undefined,
  loggingBehavior: 'production',
}

export default config
