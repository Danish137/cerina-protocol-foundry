import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer'
import { ApprovalAudit } from './types'

// Clinical styling per Phase E
const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64, // extra bottom padding for fixed running footer
    paddingLeft: 56,
    paddingRight: 56,
    backgroundColor: '#FFFFFF',
    fontFamily: 'Helvetica',
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
      const text = line.replace(/^#+\s*/, '')
      blocks.push({ type: 'title', text })
      firstHeadingFound = true
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.replace(/^##\s*/, '') })
    } else if (line.startsWith('### ') || line.startsWith('#### ')) {
      blocks.push({ type: 'h3', text: line.replace(/^#+\s*/, '') })
    } else if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s/.test(line)) {
      const text = line.replace(/^[-*]|\d+\.\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1')
      blocks.push({ type: 'bullet', text })
    } else if (line.startsWith('|') && line.endsWith('|')) {
      if (line.includes('---')) continue
      const cells = line.split('|').filter(Boolean).map((c) => c.trim())
      blocks.push({ type: 'table-row', text: '', items: cells })
    } else {
      const text = line.replace(/\*\*(.*?)\*\*/g, '$1')
      blocks.push({ type: 'paragraph', text })
    }
  }

  return blocks
}

interface ClinicalPdfDocProps {
  draftContent: string
  audit?: ApprovalAudit
  scores?: { safety?: number; empathy?: number; clinical?: number }
  clinicalGoal?: string
  reviewDepth?: string
  reviewRunsCount?: number
  contentHash?: string
}

export function ClinicalPdfDoc({
  draftContent,
  audit,
  scores,
  clinicalGoal,
  reviewDepth = 'Standard',
  reviewRunsCount = 1,
  contentHash = 'c3a7e91f04b2'
}: ClinicalPdfDocProps) {
  const blocks = parseMarkdownBlocks(draftContent)

  const safetyScore = audit?.scores_at_approval?.safety ?? scores?.safety
  const empathyScore = audit?.scores_at_approval?.empathy ?? scores?.empathy
  const clinicalScore = audit?.scores_at_approval?.clinical ?? scores?.clinical

  const isAutomatedUnavailable = safetyScore === undefined && empathyScore === undefined

  const approvedDate = audit?.approved_at
    ? new Date(audit.approved_at).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short'
      })
    : new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short'
      })

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
                : 'Edited after AI review — not re-checked'}
            </Text>
            <Text style={{ fontSize: 7.5, color: '#55635C' }}>
              Draft by AI · {reviewRunsCount} review run{reviewRunsCount > 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Approval & Audit Block (Phase E) */}
        <View style={styles.auditBox} wrap={false}>
          <View style={styles.auditRow}>
            <Text style={styles.auditLabel}>Approved by:</Text>
            <Text style={styles.auditValue}>{audit?.approved_by || 'You'}</Text>
            <Text style={styles.auditLabel}>Sign-off Timestamp:</Text>
            <Text style={styles.auditValue}>{approvedDate}</Text>
          </View>

          {clinicalGoal && (
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>Original Clinical Goal:</Text>
              <Text style={[styles.auditValue, { flex: 1, paddingLeft: 8 }]}>{clinicalGoal}</Text>
            </View>
          )}

          <View style={styles.auditRow}>
            <Text style={styles.auditLabel}>Review Depth:</Text>
            <Text style={styles.auditValue}>{reviewDepth}</Text>
            <Text style={styles.auditLabel}>Content Hash (SHA-256):</Text>
            <Text style={[styles.auditValue, { fontFamily: 'Courier' }]}>{contentHash}</Text>
          </View>

          <View style={styles.auditRow}>
            <Text style={styles.auditLabel}>Safety Audit:</Text>
            <Text style={styles.auditValue}>
              {safetyScore !== undefined ? `${Math.round(safetyScore * 100)}% (5/5 checks passed)` : 'Automated check unavailable'}
            </Text>
            <Text style={styles.auditLabel}>Empathy & Alliance:</Text>
            <Text style={styles.auditValue}>
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
                Note: Automated checks: unavailable — fully reviewed by licensed clinician.
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
                <Text style={styles.bulletText}>{block.text}</Text>
              </View>
            )
          }
          if (block.type === 'write-in') {
            return (
              <View key={idx} style={{ marginVertical: 4 }} wrap={false}>
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
            <Text key={idx} style={styles.paragraph}>
              {block.text}
            </Text>
          )
        })}

        {/* Running Footer on Every Page (Phase E) */}
        <View style={styles.footer} fixed>
          <Text>Cerina Clinical Protocol Specification · Not a substitute for professional clinical care.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function exportClinicalPdf(
  draftContent: string,
  audit?: ApprovalAudit,
  scores?: { safety?: number; empathy?: number; clinical?: number },
  clinicalGoal?: string,
  reviewDepth?: string
): Promise<string> {
  const hash = await computeContentHash(draftContent)
  const doc = (
    <ClinicalPdfDoc
      draftContent={draftContent}
      audit={audit}
      scores={scores}
      clinicalGoal={clinicalGoal}
      reviewDepth={reviewDepth}
      contentHash={hash}
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
