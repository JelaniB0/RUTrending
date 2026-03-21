import { embedText } from './lib/embed'

async function main() {
  const result = await embedText('test narrative about a broken lock')
  console.log('Embedding length:', result.length)
  console.log('First 5 values:', result.slice(0, 5))
}

main().catch(console.error)