// doesn't work for now. 

import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.GITHUB_TOKEN!,
  baseURL: 'https://models.inference.ai.azure.com/',  // trailing slash is the fix
})

export async function embedText(text: string): Promise<number[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    }, { signal: controller.signal })
    clearTimeout(timeout)
    return response.data[0].embedding
  } catch (e: any) {
    clearTimeout(timeout)
    throw new Error('Embedding timed out — try again')
  }
}

export async function searchReports(queryEmbedding: number[], limit = 10): Promise<{ id: string; similarity: number }[]> {
  const { prisma } = await import('./prisma')
  const vector = `[${queryEmbedding.join(',')}]`

  const results = await prisma.$queryRawUnsafe(`
    SELECT id::text, 1 - (narrative_embedding <=> $1::vector) AS similarity
    FROM reports
    WHERE narrative_embedding IS NOT NULL
    ORDER BY narrative_embedding <=> $1::vector
    LIMIT $2
  `, vector, limit) as { id: string; similarity: number }[]

  console.log('Vector search results:', results)
  return results
}