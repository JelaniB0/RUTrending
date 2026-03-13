import * as dotenv from 'dotenv'
dotenv.config()

import { runTrendAnalysis } from './agents'

async function main() {
  console.log('🚀 Running trend analysis agents...\n')
  const result = await runTrendAnalysis({})
  
  console.log('\n═══════════════════════════════════════')
  console.log('ALERTS:')
  result.alerts.forEach((a: string) => console.log(' ', a))
  
  console.log('\n═══════════════════════════════════════')
  console.log('FINAL REPORT:')
  console.log(result.finalReport)
}

main().catch(console.error)