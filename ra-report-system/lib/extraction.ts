import * as dotenv from 'dotenv'
dotenv.config()

import { ChatOpenAI } from '@langchain/openai'
import { PromptTemplate } from '@langchain/core/prompts'
import { JsonOutputParser } from '@langchain/core/output_parsers'

// ─── MODEL SETUP ─────────────────────────────────────────────────────────────

const model = new ChatOpenAI({
  model: 'gpt-4o-mini',
  apiKey: process.env.GITHUB_TOKEN!,
  configuration: {
    baseURL: 'https://models.inference.ai.azure.com',
  },
  temperature: 0,
})

// ─── OUTPUT TYPES ─────────────────────────────────────────────────────────────

export interface ExtractedReport {
  involved_parties: Array<{
    name: string
    role: 'ACCUSED' | 'VICTIM' | 'WITNESS' | 'STUDENT_OF_CONCERN' | 'INVOLVED_PARTY'
    hall?: string
    ruid?: string
  }>
  location_references: Array<{
    building: string
    specific_location: string
  }>
  timeline: Array<{
    time: string
    actor: string
    action: string
  }>
  severity_signals: string[]
  policy_references: string[]
  prior_report_references: string[]
  summary: string
}

// ─── EXTRACTION PROMPT ────────────────────────────────────────────────────────

const extractionPrompt = PromptTemplate.fromTemplate(`
You are an expert at analyzing Rutgers University Residence Life incident reports.
Extract structured information from the following narrative.

NARRATIVE:
{narrative}

Extract and return a JSON object with exactly these fields:
{{
  "involved_parties": [
    {{
      "name": "full name of person",
      "role": "one of: ACCUSED, VICTIM, WITNESS, STUDENT_OF_CONCERN, INVOLVED_PARTY",
      "hall": "their residence hall if mentioned",
      "ruid": "their RUID if mentioned, otherwise null"
    }}
  ],
  "location_references": [
    {{
      "building": "building name",
      "specific_location": "room number, floor, lounge, etc."
    }}
  ],
  "timeline": [
    {{
      "time": "time in format like 11:45pm",
      "actor": "who performed this action",
      "action": "brief description of what happened"
    }}
  ],
  "severity_signals": ["list of phrases or facts indicating severity, e.g. 'transported to hospital', 'weapon present', 'loss of consciousness'"],
  "policy_references": ["list of specific policies mentioned or implied, e.g. 'Alcohol Policy', 'Guest Policy'"],
  "prior_report_references": ["any references to previous incidents or prior reports"],
  "summary": "2-3 sentence plain English summary of the incident"
}}

Return ONLY valid JSON. No explanation, no markdown, no backticks.
`)

// ─── EXTRACTION CHAIN ─────────────────────────────────────────────────────────

const parser = new JsonOutputParser<ExtractedReport>()
const extractionChain = extractionPrompt.pipe(model).pipe(parser)

// ─── MAIN EXTRACTION FUNCTION ─────────────────────────────────────────────────

export async function extractFromNarrative(narrative: string): Promise<ExtractedReport> {
  const result = await extractionChain.invoke({ narrative })
  return result
}