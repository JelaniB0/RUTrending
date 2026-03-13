import * as dotenv from 'dotenv'
dotenv.config()

import { extractFromNarrative } from './extraction'

const testNarrative = `On Tuesday, September 2, 2025 at 6:30am, Resident Assistant Aisha Okafor was approached by resident Leila Singh of Apartment 39A in Thomas Suites, who asked to speak privately. Aisha met with Leila in the RA office. Leila disclosed that a former partner had been sending repeated unsolicited and sexually explicit messages over the past several weeks. Leila appeared visibly distressed throughout the conversation. Aisha informed Leila that Aisha was a mandated reporter and explained what that meant and what would happen next. Aisha provided Leila with information about VPVPA, RUPD, CAPS, and the confidential sexual violence support advocate. Leila agreed to speak with RUPD. Aisha called RUPD at 6:39am and notified ARLC Michelle Park at 6:39am. ARLC Michelle arrived at the scene at 6:56am. RUPD arrived at 6:56am and conducted a private interview with Leila. RUPD issued CAD number 26-33028. End of report.`

async function main() {
  console.log('Testing extraction pipeline...\n')
  const result = await extractFromNarrative(testNarrative)
  console.log(JSON.stringify(result, null, 2))
}

main().catch(console.error)