import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const buildings = await prisma.building.findMany({ select: { name: true, campus: true }, orderBy: { name: 'asc' } })
buildings.forEach(b => console.log(b.campus + ' | ' + b.name))
await prisma.$disconnect()