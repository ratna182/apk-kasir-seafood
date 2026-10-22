import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  await prisma.kasirSesi.deleteMany()
  await prisma.transaksiItem.deleteMany()
  await prisma.transaksi.deleteMany()
  await prisma.warungMenu.deleteMany()
  await prisma.menu.deleteMany()
  await prisma.menuCategory.deleteMany()
  await prisma.user.deleteMany()
  await prisma.warung.deleteMany()

  const warung1 = await prisma.warung.create({
    data: { nama: 'Seafood Vian Jaya 08 (Kranggan)', kode: 'VJ08-1' },
  })
  const warung2 = await prisma.warung.create({
    data: { nama: 'Seafood & Nasi Uduk Vian Jaya 08 - Cabang 2', kode: 'VJ08-2' },
  })
  const warung3 = await prisma.warung.create({
    data: { nama: 'Seafood & Nasi Uduk Vian Jaya 08 - Cabang 3', kode: 'VJ08-3' },
  })

  console.log('✅ 3 warung dibuat')

  const ownerPasswordHash = await bcrypt.hash('owner123', 8)
  await prisma.user.create({
    data: {
      username: 'owner',
      passwordHash: ownerPasswordHash,
      namaLengkap: 'Owner Vian Jaya 08',
      role: 'OWNER',
    },
  })

  console.log('✅ Akun owner dibuat (username=owner, password=owner123)')

  const kasirPasswordHash = await bcrypt.hash('kasir123', 8)
  await prisma.user.createMany({
    data: [
      { warungId: warung1.id, username: 'kasir1', passwordHash: kasirPasswordHash, namaLengkap: 'Kasir Cabang 1', role: 'KASIR' },
      { warungId: warung2.id, username: 'kasir2', passwordHash: kasirPasswordHash, namaLengkap: 'Kasir Cabang 2', role: 'KASIR' },
    ],
  })

  console.log('✅ 2 akun kasir dibuat (password: kasir123)')

  const categories = ['Lainnya', 'Nasi', 'Udang', 'Kerang', 'Kepiting', 'Cumi', 'Ikan Bakar', 'Sayur', 'Ayam/Bebek/Lauk', 'Minuman']

  for (const warung of [warung1, warung2, warung3]) {
    const categoryRecords = await Promise.all(
      categories.map((nama, i) =>
        prisma.menuCategory.create({ data: { warungId: warung.id, nama, sortOrder: i } })
      )
    )
    const lainnyaId = categoryRecords[0].id

    await prisma.menu.createMany({
      data: [
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Nasi Uduk', harga: 15000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Cumi Goreng', harga: 35000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Udang Goreng', harga: 40000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Ikan Bakar', harga: 45000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Kepiting Rebus', harga: 75000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Kerang Rebus', harga: 30000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Ayam Goreng', harga: 25000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Es Teh Manis', harga: 5000, isAktif: true },
        { warungId: warung.id, categoryId: lainnyaId, nama: 'Es Jeruk', harga: 8000, isAktif: true },
      ],
    })
  }

  console.log('✅ Menu dan kategori di-seed untuk semua 3 warung')
  console.log('')
  console.log('📋 Akun login:')
  console.log('  Owner:    username=owner    password=owner123')
  console.log('  Warung 1: username=kasir1   password=kasir123')
  console.log('  Warung 2: username=kasir2   password=kasir123')
  console.log('')
  console.log('🎉 Seeding selesai!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
