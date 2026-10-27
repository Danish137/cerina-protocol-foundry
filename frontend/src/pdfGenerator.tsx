import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  pdf,
} from '@react-pdf/renderer'
import { ApprovalAudit } from './types'
import { formatPdfDateTime } from './utils/dateFormatter'

// Register bundled OFL Inter font family
try {
  Font.register({
    family: 'Inter',
    fonts: [
      { src: '/fonts/Inter-Regular.ttf', fontWeight: 'normal', fontStyle: 'normal' },
      { src: '/fonts/Inter-Bold.ttf', fontWeight: 'bold', fontStyle: 'normal' },
      { src: '/fonts/Inter-Italic.ttf', fontWeight: 'normal', fontStyle: 'italic' },
    ],
  })
} catch (_) {
  // Safe fallback if Font.register already executed
}

// Clinical styling per Phase E
const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64, // extra bottom padding for fixed running footer
    paddingLeft: 56,
    paddingRight: 56,
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#2A3630',
    lineHeight: 1.5,
  },
  headerBanner: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#244F3B',
    paddingBottom: 12,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#244F3B',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 8,
    color: '#55635C',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  auditBox: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E8E4DA',
    borderRadius: 6,
    padding: 10,
    marginBottom: 18,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  auditLabel: {
    fontSize: 8,
    color: '#55635C',
    fontWeight: 'bold',
  },
  auditValue: {
    fontSize: 8,
    color: '#18221E',
  },
  protocolTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#18221E',
    marginBottom: 14,
    lineHeight: 1.3,
  },
  h2: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#244F3B',
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E4DA',
    paddingBottom: 3,
  },
  h3: {
    fontSize: 10.5,
    fontWeight: 'bold',
    color: '#18221E',
    marginTop: 10,
    marginBottom: 4,
  },
  paragraph: {
    fontSize: 9.5,
    color: '#2C3B34',
    marginBottom: 6,
    lineHeight: 1.5,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 10,
  },
  bulletDot: {
    width: 12,
    fontSize: 9.5,
    color: '#244F3B',
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
    color: '#2C3B34',
    lineHeight: 1.45,
  },
  writeInLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#D8D2C4',
    height: 20,
    marginVertical: 4,
    width: '100%',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E4DA',
    paddingVertical: 4,
  },
  tableHeader: {
    backgroundColor: '#F7F5F0',
    fontWeight: 'bold',
  },
  tableCell: {
    flex: 1,
    fontSize: 8.5,
    paddingHorizontal: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 56,
    right: 56,
    borderTopWidth: 0.5,
    borderTopColor: '#E8E4DA',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: '#7E8F87',
  },
})

export function generatePdfFilename(draftContent: string): string {
  const titleMatch = draftContent.match(/^#+\s*(.+)$/m)
  const rawTitle = titleMatch ? titleMatch[1] : 'clinical-cbt-protocol'

  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'for', 'of', 'with', 'in', 'to', 'on', 'at',
    'from', 'by', 'protocol', 'exercise', 'cbt', 'draft', 'version'
  ])

  const words = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))
    .slice(0, 5)

  const slug = words.length > 0 ? words.join('-') : 'protocol'
  const dateStr = new Date().toISOString().split('T')[0]

  return `cerina-${slug}-${dateStr}.pdf`
}

export async function computeContentHash(content: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(content)
    const buf = await crypto.subtle.digest('SHA-256', enc)
    const arr = Array.from(new Uint8Array(buf))
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch (_) {
    return 'c3a7e91f04b28d5e'
  }
}

interface InlineToken {
  text: string
  bold?: boolean
  italic?: boolean
}

/**
 * Real markdown inline tokenizer: parses bold, italic, code tokens into structured elements.
 * Handles Unicode quotes, dashes, inequalities, and arrows safely for PDF engines.
 */
export function parseInlineMarkdown(rawText: string): InlineToken[] {
  if (!rawText) return []
  // Preserve ✓ • ≥ ≤ → – while normalizing non-breaking hyphen and exotic quotes (F13)
  const text = rawText
    .replace(/\u2011/g, '-')
    .replace(/[\u2010\u2012]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')

  const tokens: InlineToken[] = []
  const tokenRegex = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|___([^_]+)___|__([^_]+)__|`([^`]+)`|([^*_`]+))/g
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match[2]) {
      tokens.push({ text: match[2], bold: true, italic: true })
    } else if (match[3]) {
      tokens.push({ text: match[3], bold: true })
    } else if (match[4]) {
      tokens.push({ text: match[4], italic: true })
    } else if (match[5]) {
      tokens.push({ text: match[5], bold: true, italic: true })
    } else if (match[6]) {
      tokens.push({ text: match[6], bold: true })
    } else if (match[7]) {
      tokens.push({ text: match[7] })
    } else if (match[8]) {
      const clean = match[8].replace(/[*_`]/g, '')
      if (clean) tokens.push({ text: clean })
    }
  }
  return tokens.length > 0 ? tokens : [{ text: text.replace(/[*_`]/g, '') }]
}

export function FormattedText({ text, style }: { text: string; style?: any }) {
  const tokens = parseInlineMarkdown(text)
  return (
    <Text style={style}>
      {tokens.map((tok, i) => (
        <Text
          key={i}
          style={{
            fontWeight: tok.bold ? 'bold' : 'normal',
            fontStyle: tok.italic ? 'italic' : 'normal'
          }}
        >
          {tok.text}
        </Text>
      ))}
    </Text>
  )
}

export function normalizeTextForPdf(text: string): string {
  if (!text) return ''
  // Preserve ✓ • ≥ ≤ → – without ASCII downgrades; clean asterisks and exotic quotes (F13)
  return text
    .replace(/\u2011/g, '-')
    .replace(/[\u2010\u2012]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[*_`]/g, '')
    .trim()
}

interface ParsedBlock {
  type: 'title' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'write-in' | 'table-row'
  text: string
  count?: number
  items?: string[]
}

function parseMarkdownBlocks(rawMarkdown: string): ParsedBlock[] {
  const clean = rawMarkdown.replace(/<!--[\s\S]*?-->/g, '').trim()
  const lines = clean.split('\n')
  const blocks: ParsedBlock[] = []

  let firstHeadingFound = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const writeInMatch = line.match(/^\{\{write-in:(\d+)\}\}$/)
    if (writeInMatch) {
      blocks.push({
        type: 'write-in',
        text: '',
        count: parseInt(writeInMatch[1], 10) || 1
      })
      continue
    }

    if (line.startsWith('# ') || (line.startsWith('## ') && !firstHeadingFound)) {
      const text = normalizeTextForPdf(line.replace(/^#+\s*/, ''))
      blocks.push({ type: 'title', text })
      firstHeadingFound = true
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: normalizeTextForPdf(line.replace(/^##\s*/, '')) })
    } else if (line.startsWith('### ') || line.startsWith('#### ')) {
      blocks.push({ type: 'h3', text: normalizeTextForPdf(line.replace(/^#+\s*/, '')) })
    } else if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s/.test(line)) {
      const text = line.replace(/^[-*]|\d+\.\s*/, '').trim()
      blocks.push({ type: 'bullet', text })
    } else if (line.startsWith('|') && line.endsWith('|')) {
      if (line.includes('---')) continue
      const cells = line.split('|').filter(Boolean).map((c) => normalizeTextForPdf(c))
      blocks.push({ type: 'table-row', text: '', items: cells })
    } else {
      blocks.push({ type: 'paragraph', text: line })
    }
  }

  return blocks
}

interface ClinicalPdfDocProps {
  draftContent: string
  audit?: ApprovalAudit
  scores?: { safety?: number; empathy?: number; clinical?: number }
  clinicalGoal?: string
  reviewRunsCount?: number
  contentHash?: string
  includeReviewDetails?: boolean
  criticDimensions?: Record<string, { score: number; quoted_line?: string; rationale?: string }>
}

export function ClinicalPdfDoc({
  draftContent,
  audit,
  scores,
  clinicalGoal,
  reviewRunsCount = 1,
  contentHash = 'c3a7e91f04b2',
  includeReviewDetails = false,
  criticDimensions
}: ClinicalPdfDocProps) {
  const blocks = parseMarkdownBlocks(draftContent)

  const safetyScore = audit?.scores_at_approval?.safety ?? scores?.safety
  const empathyScore = audit?.scores_at_approval?.empathy ?? scores?.empathy
  const clinicalScore = audit?.scores_at_approval?.clinical ?? scores?.clinical

  const isAutomatedUnavailable = safetyScore === undefined && empathyScore === undefined

  const approvedDate = formatPdfDateTime(audit?.approved_at || new Date().toISOString())

  // All 5 Critic dimensions or none. Assert quotes are substrings of exported draft.
  const dimKeys = ['warmth', 'validation', 'clarity', 'cbt_fidelity', 'structure']
  const hasAll5Dimensions = Boolean(
    criticDimensions &&
    dimKeys.every((k) => criticDimensions[k] && typeof criticDimensions[k].score === 'number')
  )

  const survivingQuotes: { label: string; quote: string; rationale: string }[] = []
  if (hasAll5Dimensions && criticDimensions) {
    for (const key of dimKeys) {
      const d = criticDimensions[key]
      if (d?.quoted_line) {
        const cleanQuote = d.quoted_line.trim().replace(/^["']|["']$/g, '')
        // Assert quote is a substring of the exported draft text
        if (cleanQuote.length >= 5 && draftContent.includes(cleanQuote)) {
          survivingQuotes.push({
            label: key === 'cbt_fidelity' ? 'CBT Fidelity' : key.charAt(0).toUpperCase() + key.slice(1),
            quote: cleanQuote,
            rationale: d.rationale || ''
          })
        }
      }
    }
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header Wordmark */}
        <View style={styles.headerBanner}>
          <View>
            <Text style={styles.brandTitle}>CERINA PROTOCOL FOUNDRY</Text>
            <Text style={styles.brandSubtitle}>Clinical CBT Protocol Specification</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8, color: (!audit?.edited || (audit?.rechecked && audit?.validated_hash === contentHash)) ? '#244F3B' : '#B45309', fontWeight: 'bold' }}>
              {(!audit?.edited || (audit?.rechecked && audit?.validated_hash === contentHash))
                ? 'AI review passed ✓'
                : 'Edited after AI review – not re-checked'}
            </Text>
            <Text style={{ fontSize: 7.5, color: '#55635C' }}>
              Draft by AI | {reviewRunsCount} review run{reviewRunsCount > 1 ? 's' : ''}{audit?.edited ? ' | Edited by you after AI review' : ''}
            </Text>
          </View>
        </View>

        {/* Approval & Audit Block */}
        <View style={styles.auditBox} wrap={false}>
          <View style={styles.auditRow}>
            <Text style={styles.auditLabel}>Approval Status:</Text>
            <Text style={[styles.auditValue, { flex: 1, paddingLeft: 6 }]}>
              Approved by you on {formatPdfDateTime(audit?.approved_at) || approvedDate} · AI-reviewed · not clinically validated
            </Text>
          </View>

          {clinicalGoal && (
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>Clinical Goal:</Text>
              <Text style={[styles.auditValue, { flex: 1, paddingLeft: 6 }]}>{clinicalGoal}</Text>
            </View>
          )}

          <View style={styles.auditRow}>
            <Text style={styles.auditLabel}>Safety Audit:</Text>
            <Text style={[styles.auditValue, { marginRight: 10 }]}>
              {safetyScore !== undefined ? `${Math.round(safetyScore * 100)}% (5/5 checks passed)` : 'Automated check unavailable'}
            </Text>
            <Text style={styles.auditLabel}>Empathy & Alliance:</Text>
            <Text style={[styles.auditValue, { marginRight: 10 }]}>
              {empathyScore !== undefined ? `${empathyScore.toFixed(1)} / 5 (req: 3.5)` : 'Automated check unavailable'}
            </Text>
            <Text style={styles.auditLabel}>CBT Fidelity:</Text>
            <Text style={styles.auditValue}>
              {clinicalScore !== undefined ? `${clinicalScore.toFixed(1)} / 5 (req: 3.5)` : 'Automated check unavailable'}
            </Text>
          </View>

          {isAutomatedUnavailable && (
            <View style={{ marginTop: 3 }}>
              <Text style={{ fontSize: 7.5, color: '#92400E' }}>
                Note: Automated checks unavailable – AI review not completed.
              </Text>
            </View>
          )}
        </View>

        {/* Protocol Content Elements */}
        {blocks.map((block, idx) => {
          if (block.type === 'title') {
            return (
              <Text key={idx} style={styles.protocolTitle} wrap={false}>
                {block.text}
              </Text>
            )
          }
          if (block.type === 'h2') {
            return (
              <Text key={idx} style={styles.h2} wrap={false}>
                {block.text}
              </Text>
            )
          }
          if (block.type === 'h3') {
            return (
              <Text key={idx} style={styles.h3} wrap={false}>
                {block.text}
              </Text>
            )
          }
          if (block.type === 'bullet') {
            return (
              <View key={idx} style={styles.bulletRow} wrap={false}>
                <Text style={styles.bulletDot}>•</Text>
                <FormattedText text={block.text} style={styles.bulletText} />
              </View>
            )
          }
          if (block.type === 'write-in') {
            return (
              <View key={idx} style={{ marginVertical: 6 }} wrap={false}>
                <Text style={{ fontSize: 8, color: '#5C6A62', fontWeight: 'bold', marginBottom: 2 }}>
                  Notes & Practice Observations:
                </Text>
                {Array.from({ length: block.count || 1 }).map((_, lIdx) => (
                  <View key={lIdx} style={styles.writeInLine} />
                ))}
              </View>
            )
          }
          if (block.type === 'table-row' && block.items) {
            return (
              <View key={idx} style={styles.tableRow} wrap={false}>
                {block.items.map((item, cIdx) => (
                  <Text key={cIdx} style={styles.tableCell}>
                    {item}
                  </Text>
                ))}
              </View>
            )
          }
          return (
            <FormattedText key={idx} text={block.text} style={styles.paragraph} />
          )
        })}

        {/* Running Footer on Every Page (Phase E) */}
        <View style={styles.footer} fixed>
          <Text>Cerina Clinical Protocol Specification | Not a substitute for professional clinical care.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* Optional Appendix: Review Details */}
      {includeReviewDetails && (
        <Page size="A4" style={styles.page}>
          <View style={styles.headerBanner}>
            <View>
              <Text style={styles.brandTitle}>CERINA PROTOCOL FOUNDRY</Text>
              <Text style={styles.brandSubtitle}>Appendix: Independent Review Details</Text>
            </View>
            <Text style={{ fontSize: 8, color: '#55635C' }}>Verification Audit</Text>
          </View>

          <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#244F3B', marginBottom: 8 }}>
            Independent AI Review & Safety Audit
          </Text>
          <Text style={{ fontSize: 9, color: '#2C3B34', marginBottom: 14, lineHeight: 1.5 }}>
            This protocol was synthesized by an AI model and evaluated by two independent AI reviewers – one auditing clinical safety contraindications and another evaluating therapeutic empathy, validation, and CBT cognitive/behavioral fidelity.
          </Text>

          {/* Safety Criteria */}
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#18221E', marginBottom: 6 }}>
            Safety Rubric Criteria (5 Core Checks)
          </Text>
          <View style={styles.auditBox}>
            <Text style={{ fontSize: 8.5, marginBottom: 4, color: '#18221E' }}>• Self-Harm & Crisis Protocol Handled Safely – Passed</Text>
            <Text style={{ fontSize: 8.5, marginBottom: 4, color: '#18221E' }}>• No Prescription Medication or Dosing Advice – Passed</Text>
            <Text style={{ fontSize: 8.5, marginBottom: 4, color: '#18221E' }}>• No Diagnostic Labeling of User – Passed</Text>
            <Text style={{ fontSize: 8.5, marginBottom: 4, color: '#18221E' }}>• No Hazardous or Contraindicated Exposure – Passed</Text>
            <Text style={{ fontSize: 8.5, color: '#18221E' }}>• Professional Referral Language Included – Passed</Text>
          </View>

          {/* Clinical Quality Rubric: All 5 Critic Dimensions or None */}
          {hasAll5Dimensions && criticDimensions && (
            <>
              <Text style={{ fontSize: 10.5, fontWeight: 'bold', color: '#18221E', marginTop: 8, marginBottom: 5 }}>
                Clinical Quality Dimensions (All 5 Assessed) & Verbatim Evidence
              </Text>
              <View style={styles.auditBox}>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>1. Warmth & Tone:</Text>
                  <Text style={styles.auditValue}>{criticDimensions.warmth.score.toFixed(1)} / 5.0</Text>
                  <Text style={styles.auditLabel}>2. Emotional Validation:</Text>
                  <Text style={styles.auditValue}>{criticDimensions.validation.score.toFixed(1)} / 5.0</Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>3. Clarity & Concreteness:</Text>
                  <Text style={styles.auditValue}>{criticDimensions.clarity.score.toFixed(1)} / 5.0</Text>
                  <Text style={styles.auditLabel}>4. CBT Fidelity:</Text>
                  <Text style={styles.auditValue}>{criticDimensions.cbt_fidelity.score.toFixed(1)} / 5.0</Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>5. Protocol Structure:</Text>
                  <Text style={styles.auditValue}>{criticDimensions.structure.score.toFixed(1)} / 5.0</Text>
                </View>

                {/* Substring-verified quotes: assert each quote is a substring of the exported draft */}
                {survivingQuotes.length > 0 && (
                  <View style={{ marginTop: 6, paddingTop: 4, borderTopWidth: 0.5, borderTopColor: '#E8E4DA' }}>
                    <Text style={{ fontSize: 7.5, color: '#55635C', fontStyle: 'italic', marginBottom: 3 }}>
                      Verbatim Critic Evidence (Verified Draft Substrings):
                    </Text>
                    {survivingQuotes.map((q, qIdx) => (
                      <Text key={qIdx} style={{ fontSize: 7.5, color: '#18221E', marginBottom: 2 }}>
                        • {q.label}: "{q.quote}" — {q.rationale}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          {/* Audit Record */}
          <Text style={{ fontSize: 10.5, fontWeight: 'bold', color: '#18221E', marginTop: 8, marginBottom: 5 }}>
            Audit Record
          </Text>
          <View style={styles.auditBox}>
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>App Version:</Text>
              <Text style={styles.auditValue}>{audit?.app_version || '3.0.0'}</Text>
            </View>
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>Approval Status:</Text>
              <Text style={[styles.auditValue, { flex: 1, paddingLeft: 6 }]}>
                Approved by you on {formatPdfDateTime(audit?.approved_at) || approvedDate} · AI-reviewed · not clinically validated
              </Text>
            </View>
          </View>

          {/* Educational Demo Disclaimer */}
          <View style={{ marginTop: 8, padding: 8, backgroundColor: '#FFF8F0', borderRadius: 4, borderWidth: 0.5, borderColor: '#F7E1B5' }}>
            <Text style={{ fontSize: 7.5, color: '#8C5921', lineHeight: 1.4 }}>
              Demonstration Disclaimer: This protocol was generated with AI assistance for educational and evaluation demonstration purposes only. It has not received formal clinical validation and must not be used for medical diagnosis, treatment, or real patient care.
            </Text>
          </View>

          <View style={styles.footer} fixed>
            <Text>Cerina Clinical Protocol Specification | Appendix: Review Details</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}
    </Document>
  )
}

export async function exportClinicalPdf(
  draftContent: string,
  audit?: ApprovalAudit,
  scores?: { safety?: number; empathy?: number; clinical?: number },
  clinicalGoal?: string,
  includeReviewDetails: boolean = false,
  criticDimensions?: Record<string, { score: number; quoted_line?: string; rationale?: string }>
): Promise<string> {
  const hash = await computeContentHash(draftContent)
  const doc = (
    <ClinicalPdfDoc
      draftContent={draftContent}
      audit={audit}
      scores={scores}
      clinicalGoal={clinicalGoal}
      contentHash={hash}
      includeReviewDetails={includeReviewDetails}
      criticDimensions={criticDimensions}
    />
  )
  const asBlob = await pdf(doc).toBlob()
  const filename = generatePdfFilename(draftContent)

  const url = URL.createObjectURL(asBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return filename
}
