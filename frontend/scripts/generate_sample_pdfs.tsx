import React from 'react'
import path from 'path'
import { renderToFile } from '@react-pdf/renderer'
import { ClinicalPdfDoc } from '../src/pdfGenerator'

const sampleDraft = `# Stimulus Control and Sleep Hygiene Protocol for Sleep-Onset Insomnia

## Introduction
This evidence-based Cognitive Behavioral Therapy for Insomnia (CBT-I) protocol is designed for adults experiencing difficulty initiating sleep. Stimulus control strengthens the conditioned association between the bed and rapid sleep onset, while sleep hygiene optimizes physiological readiness for rest.

## Goals
- Re-establish the bed and bedroom as strong discriminative stimuli for sleep rather than frustration or alertness.
- Maintain a consistent sleep-wake schedule to consolidate homeostatic sleep drive.
- Eliminate sleep-incompatible autonomic arousal in the bedroom.

## Step-by-Step Instructions
### Step 1: The 20-Minute Re-Association Rule
Go to bed only when genuinely sleepy. If you have not fallen asleep within approximately 20 minutes:
- Leave the bedroom immediately.
- Move to a dimly lit room and engage in a quiet, non-screen activity (e.g., reading a physical book, gentle somatic relaxation).
- Return to bed only when drowsiness returns. Repeat as often as necessary throughout the night.

### Step 2: Bedroom Exclusivity
Do not use the bed for any activities other than sleep and sexual intimacy. Reading, watching television, checking phones, eating, or working must occur outside the bedroom.

### Step 3: Anchor Wake Time
Set a non-negotiable wake-up time 7 days a week, regardless of how much sleep you obtained the previous night. Do not compensate with daytime naps.

## Practice and Homework
- Keep a 7-day sleep diary recording bed time, estimated sleep onset latency, night awakenings, and final rising time.
- Implement the 20-minute rule consistently every night for the upcoming 14 days without exception.

{{write-in:3}}

## Reflection and Progress Review
- Did you notice any anticipatory anxiety when getting into bed?
- How many times did you leave the bedroom before sleep onset occurred?
- What calming activity proved most effective during the out-of-bed interval?

## Conclusion
Conditioned insomnia develops gradually and requires 2-4 weeks of consistent behavioral practice to extinguish. If insomnia symptoms persist beyond 4 weeks or if daytime impairment impairs safety, consult a licensed clinical psychologist or sleep medicine physician for personalized care.
`

const sampleAudit = {
  approved_by: "You",
  approved_at: "2026-10-14T14:30:00Z",
  validated_hash: "8d1bea3a68a27598",
  content_hash: "8d1bea3a68a27598",
  scores_at_approval: {
    safety: 1.0,
    empathy: 4.8,
    clinical: 4.7
  },
  app_version: "3.0.0",
  edited: false,
  rechecked: false
}

async function main() {
  const outDir = path.resolve(process.cwd(), '../docs/evidence')

  const pdfNoAppPath = path.join(outDir, 'cerina_protocol_no_appendix.pdf')
  console.log('Rendering PDF without appendix to:', pdfNoAppPath)
  await renderToFile(
    <ClinicalPdfDoc
      draftContent={sampleDraft}
      audit={sampleAudit as any}
      scores={{ safety: 1.0, empathy: 4.8, clinical: 4.7 }}
      clinicalGoal="Design a stimulus control and sleep hygiene routine for sleep-onset insomnia"
      reviewRunsCount={1}
      contentHash="8d1bea3a68a27598"
      includeReviewDetails={false}
    />,
    pdfNoAppPath
  )
  console.log('Successfully generated:', pdfNoAppPath)

  const pdfWithAppPath = path.join(outDir, 'cerina_protocol_with_appendix.pdf')
  console.log('Rendering PDF with appendix to:', pdfWithAppPath)
  await renderToFile(
    <ClinicalPdfDoc
      draftContent={sampleDraft}
      audit={sampleAudit as any}
      scores={{ safety: 1.0, empathy: 4.8, clinical: 4.7 }}
      clinicalGoal="Design a stimulus control and sleep hygiene routine for sleep-onset insomnia"
      reviewRunsCount={1}
      contentHash="8d1bea3a68a27598"
      includeReviewDetails={true}
    />,
    pdfWithAppPath
  )
  console.log('Successfully generated:', pdfWithAppPath)
}

main().catch(err => {
  console.error('Error generating PDF:', err)
  process.exit(1)
})
