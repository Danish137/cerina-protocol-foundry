import { useState, useEffect, useRef } from 'react'
import { Edit3, Download, PauseCircle, Check, X, Sparkles, FileText, RefreshCw } from 'lucide-react'
import axios from 'axios'
import jsPDF from 'jspdf'
import API_BASE_URL from '../config'

interface ProtocolViewerProps {
  sessionId: string
  onStateChange?: (state: ProtocolState) => void
}

export interface ProtocolState {
  status: string
  user_intent?: string
  current_draft?: string
  safety_score?: number
  empathy_score?: number
  clinical_score?: number
  halted?: boolean
  human_approved?: boolean
  iteration_count?: number
  active_agent?: string
}

// Helper to format raw markdown into elegant structured clinical document HTML
function FormattedProtocolContent({ content }: { content: string }) {
  if (!content) return null

  // Split content by lines and parse structured blocks
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let currentList: string[] = []
  let listKey = 0

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="space-y-1.5 my-3 pl-5 list-disc text-sm text-[#3A4A43] leading-relaxed">
          {currentList.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ul>
      )
      currentList = []
    }
  }

  const formatInline = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-[#18221E]">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic text-[#44544D]">$1</em>')
      .replace(/`([^`]+)`/g, '<code class="font-mono text-xs bg-[#F2EFE9] px-1 py-0.5 rounded text-[#244F3B]">$1</code>')
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()

    if (!trimmed) {
      flushList()
      return
    }

    // Main Header (# or CBT Exercise:)
    if (trimmed.startsWith('# ')) {
      flushList()
      elements.push(
        <h2 key={`h1-${idx}`} className="font-serif text-xl sm:text-2xl font-bold text-[#18221E] tracking-tight pt-2 pb-2 mb-3 border-b border-[#E8E4DA]">
          {trimmed.replace(/^#\s+/, '')}
        </h2>
      )
    }
    // Subheader (## or ###)
    else if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      flushList()
      const headingText = trimmed.replace(/^#{2,3}\s+/, '')
      elements.push(
        <h3 key={`h2-${idx}`} className="font-serif text-base sm:text-lg font-semibold text-[#244F3B] mt-5 mb-2 flex items-center gap-2">
          <span>{headingText}</span>
        </h3>
      )
    }
    // Numbered step (e.g. 1. or Step 1: or 01)
    else if (/^(\d+\.|\d+\))\s+/.test(trimmed)) {
      flushList()
      const match = trimmed.match(/^(\d+)[\.\)]\s+(.*)/)
      if (match) {
        const stepNum = match[1].padStart(2, '0')
        const stepText = match[2]
        elements.push(
          <div key={`step-${idx}`} className="my-3 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] flex items-start gap-3">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#EBF3EE] text-[#244F3B] border border-[#CDE0D4] shrink-0 mt-0.5">
              {stepNum}
            </span>
            <div className="text-sm text-[#2D3A34] leading-relaxed flex-1" dangerouslySetInnerHTML={{ __html: formatInline(stepText) }} />
          </div>
        )
      }
    }
    // Bullet item (- or *)
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentList.push(trimmed.replace(/^[-*]\s+/, ''))
    }
    // Standard paragraph
    else {
      flushList()
      // Check if line is title-like (e.g. Introduction or Objectives without hash)
      if (trimmed.length < 35 && /^[A-Z][A-Za-z\s]+:?$/.test(trimmed) && !trimmed.endsWith('.')) {
        elements.push(
          <h4 key={`section-${idx}`} className="font-serif text-base font-semibold text-[#244F3B] mt-4 mb-1.5">
            {trimmed}
          </h4>
        )
      } else {
        elements.push(
          <p key={`p-${idx}`} className="text-sm text-[#3A4A43] leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }} />
        )
      }
    }
  })

  flushList()

  return <div className="space-y-1 font-sans">{elements}</div>
}

export default function ProtocolViewer({ sessionId, onStateChange }: ProtocolViewerProps) {
  const [state, setState] = useState<ProtocolState | null>(null)
  const [editedDraft, setEditedDraft] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const isEditingRef = useRef(false)

  const updateInternalState = (newState: ProtocolState) => {
    setState(newState)
    onStateChange?.(newState)
    if (newState.current_draft && !isEditingRef.current) {
      setEditedDraft(newState.current_draft)
    }
  }

  useEffect(() => {
    let timer: number | null = null
    let eventSource: EventSource | null = null

    const setup = () => {
      fetchState().then(() => {
        const streamUrl = `${API_BASE_URL}/api/protocols/${sessionId}/stream`
        eventSource = new EventSource(streamUrl)

        const handleStateUpdate = (raw: string) => {
          try {
            const data = JSON.parse(raw)
            if (data.state) {
              updateInternalState(data.state)
            }
          } catch (err) {
            console.error('Error parsing SSE data:', err)
          }
        }

        eventSource.addEventListener('state_update', (event: MessageEvent) => {
          handleStateUpdate(event.data)
        })

        eventSource.addEventListener('halted', (event: MessageEvent) => {
          handleStateUpdate(event.data)
        })

        eventSource.addEventListener('complete', (event: MessageEvent) => {
          handleStateUpdate(event.data)
          eventSource?.close()
        })

        eventSource.onmessage = (event) => {
          handleStateUpdate(event.data)
        }

        eventSource.onerror = () => {
          eventSource?.close()
        }

        eventSourceRef.current = eventSource
      })
    }

    timer = window.setTimeout(setup, 400)

    return () => {
      if (timer) clearTimeout(timer)
      if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
        eventSourceRef.current.close()
      }
    }
  }, [sessionId])

  const fetchState = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/protocols/${sessionId}/state`
      )
      const stateData = response.data.state
      if (stateData) {
        updateInternalState(stateData)
      }
    } catch (err) {
      console.error('Error fetching state:', err)
    }
  }

  const handleApprove = async () => {
    setLoading(true)
    try {
      const content = isEditing ? editedDraft : state?.current_draft
      const currentDraft = state?.current_draft || ''
      const hasEdits = isEditing && content && content.trim() !== currentDraft.trim()
      const requestBody = hasEdits ? { approved_content: content } : {}
      
      await axios.post(
        `${API_BASE_URL}/api/protocols/${sessionId}/approve`,
        requestBody,
        { headers: { 'Content-Type': 'application/json' } }
      )
      
      setIsEditing(false)
      isEditingRef.current = false
      await fetchState()
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      
      setTimeout(() => {
        const newEventSource = new EventSource(
          `${API_BASE_URL}/api/protocols/${sessionId}/stream`
        )
        newEventSource.addEventListener('state_update', (event: MessageEvent) => {
          const data = JSON.parse(event.data)
          if (data.state) updateInternalState(data.state)
        })
        newEventSource.addEventListener('complete', (event: MessageEvent) => {
          const data = JSON.parse(event.data)
          if (data.state) updateInternalState(data.state)
          newEventSource.close()
        })
        eventSourceRef.current = newEventSource
      }, 500)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to approve protocol')
    } finally {
      setLoading(false)
    }
  }

  const handleHalt = async () => {
    setLoading(true)
    try {
      await axios.post(`${API_BASE_URL}/api/protocols/${sessionId}/halt`)
      await fetchState()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to halt workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleExportPdf = () => {
    const content = isEditing ? editedDraft : state?.current_draft

    if (!content || !content.trim()) {
      alert('No protocol content available to export yet.')
      return
    }

    try {
      const doc = new jsPDF({
        unit: 'pt',
        format: 'a4',
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 45
      const maxWidth = pageWidth - margin * 2
      const lineHeight = 16

      let cursorY = 50

      // Document Header
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.setTextColor(36, 79, 59)
      doc.text('CERINA CLINICAL PROTOCOL', margin, cursorY)
      cursorY += 20

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(110, 125, 118)
      const now = new Date()
      doc.text(`Generated: ${now.toLocaleString()}  |  Session: ${sessionId}`, margin, cursorY)
      cursorY += 16

      // Divider
      doc.setDrawColor(220, 226, 222)
      doc.line(margin, cursorY, pageWidth - margin, cursorY)
      cursorY += 24

      // Body text
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10.5)
      doc.setTextColor(24, 34, 30)

      const lines = doc.splitTextToSize(content, maxWidth) as string[]

      lines.forEach((line: string) => {
        if (cursorY > pageHeight - margin) {
          doc.addPage()
          cursorY = margin
        }
        doc.text(line, margin, cursorY)
        cursorY += lineHeight
      })

      const fileName = `cerina-protocol-${now.toISOString().slice(0, 10)}.pdf`
      doc.save(fileName)
    } catch (err) {
      console.error('Error exporting PDF:', err)
      alert('Failed to generate PDF')
    }
  }

  if (!state) {
    return (
      <div className="bg-white border border-[#E8E4DA] rounded-xl p-8 text-center text-[#88978F] shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-center gap-2 mb-2 text-xs">
          <RefreshCw className="w-4 h-4 animate-spin text-[#244F3B]" />
          <span>Connecting to protocol session...</span>
        </div>
      </div>
    )
  }

  const isHalted = state.halted || state.status === 'awaiting_approval'
  const isCompleted = state.status === 'completed' || state.human_approved
  const isError = state.status === 'error'

  const scores = [
    { label: 'Safety Score', value: state.safety_score, desc: 'Risk & boundary evaluation' },
    { label: 'Empathy Rating', value: state.empathy_score, desc: 'Warmth & clinical tone' },
    { label: 'Clinical Fidelity', value: state.clinical_score, desc: 'CBT mechanism alignment' },
  ].filter((s) => s.value !== undefined && s.value !== null)

  const getStatusBadge = () => {
    if (isError) {
      return { label: 'error', style: 'bg-[#FDF3F3] text-[#9B2C2C] border-[#F5C6C6]' }
    }
    if (isCompleted) {
      return { label: 'approved & finalized', style: 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]' }
    }
    if (isHalted) {
      return { label: 'awaiting approval', style: 'bg-[#FBF5EB] text-[#8C5921] border-[#EEDDC3]' }
    }
    return { label: state.status || 'drafting', style: 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]' }
  }

  const statusBadge = getStatusBadge()

  return (
    <div className="space-y-6">
      {/* Current Protocol Header Card */}
      <div className="bg-white border border-[#E8E4DA] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="p-1 rounded bg-[#FAF8F5] text-[#244F3B] border border-[#E8E4DA]">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-[#18221E] font-sans">
                Current protocol
              </span>
              <span className="text-[#88978F]">•</span>
              <span className="text-[11px] font-mono text-[#88978F]">
                {sessionId.slice(0, 20)}
              </span>
            </div>

            <h3 className="text-lg sm:text-xl font-serif text-[#18221E] font-medium tracking-tight">
              {state.user_intent ? `“${state.user_intent}”` : '“CBT Exercise Protocol”'}
            </h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadge.style}`}>
              {statusBadge.label}
            </span>
            {state.iteration_count !== undefined && (
              <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-[#FAF8F5] text-[#55635C] border border-[#E8E4DA]">
                Iter {state.iteration_count}/5
              </span>
            )}
          </div>
        </div>

        {/* Quality Score Metrics */}
        {scores.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 mt-4 border-t border-[#F0ECE3]">
            {scores.map(({ label, value, desc }) => (
              <div
                key={label}
                className="p-3 bg-[#FAF8F5] rounded-lg border border-[#E8E4DA] flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-[#55635C]">{label}</span>
                  <span className="text-xs font-mono font-bold text-[#244F3B]">
                    {(value! * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#E8E4DA] rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-[#244F3B] rounded-full transition-all duration-500"
                    style={{ width: `${value! * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-[#88978F]">{desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Protocol Document Workspace */}
      <div className="bg-white border border-[#E8E4DA] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        {/* Document Header Bar */}
        <div className="px-6 py-3.5 bg-[#FAF8F5] border-b border-[#E8E4DA] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-[#EBF3EE] text-[#244F3B]">
              <FileText className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-[#18221E] font-sans">
              Protocol document
            </span>
            {isEditing && (
              <span className="px-2 py-0.5 rounded text-[10px] bg-[#FBF5EB] text-[#8C5921] border border-[#EEDDC3] font-mono font-medium">
                EDITING MODE
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Export PDF is only unlocked after the protocol has been approved / finalized */}
            {isCompleted && state.current_draft && (
              <button
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-[#F2EFE8] text-[#18221E] text-xs font-semibold rounded-lg border border-[#E8E4DA] transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5 text-[#55635C]" />
                <span>Export PDF</span>
              </button>
            )}

            {!isHalted && !isCompleted && (
              <button
                onClick={handleHalt}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FBF5EB] hover:bg-[#F4E9D8] disabled:opacity-40 text-[#8C5921] text-xs font-semibold rounded-lg border border-[#EEDDC3] transition-colors shadow-xs"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>Pause for Review</span>
              </button>
            )}
          </div>
        </div>

        {/* Document Body */}
        <div className="p-6 sm:p-8">
          {isEditing ? (
            <div>
              <textarea
                value={editedDraft}
                onChange={(e) => setEditedDraft(e.target.value)}
                className="w-full h-[480px] p-4 bg-[#FAF8F5] border border-[#E8E4DA] rounded-lg text-[#18221E] font-mono text-xs leading-relaxed focus:bg-white focus:outline-none focus:border-[#244F3B] focus:ring-1 focus:ring-[#244F3B] resize-y"
                placeholder="Draft CBT protocol content..."
              />
              <p className="text-xs text-[#88978F] mt-2">
                Tip: Clearly define Introduction, Objectives, Protocol Steps, Practice Exercises, and Reflection prompts.
              </p>
            </div>
          ) : (
            <div>
              {state.current_draft ? (
                <div className="max-w-none">
                  <FormattedProtocolContent content={state.current_draft} />
                </div>
              ) : (
                <div className="py-12 px-4 text-center">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#EBF3EE] text-[#244F3B] mb-3 animate-pulse">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h4 className="text-base font-serif font-semibold text-[#18221E] mb-1">
                    Building the clinical draft
                  </h4>
                  <p className="text-xs text-[#55635C] max-w-md mx-auto leading-relaxed">
                    The Clinical Drafter is structuring the evidence-based CBT protocol. The Safety Guardian and Clinical Critic will review it next.
                  </p>
                  {state.active_agent && (
                    <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF8F5] border border-[#E8E4DA] text-xs text-[#244F3B] font-mono font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#244F3B] animate-ping"></span>
                      Active reviewer: {state.active_agent}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Canonical Persistent Floating Bottom Review Action Bar */}
      {isHalted && state.current_draft && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[92vw] sm:w-auto bg-[#FAF8F5]/95 backdrop-blur-md border border-[#E2CEAF] rounded-2xl px-4 sm:px-6 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-center justify-between gap-4 transition-all duration-300">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1 rounded-full bg-[#F4DEC2] text-[#8C5921] shrink-0">
              <PauseCircle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#8C5921] truncate font-mono uppercase tracking-wide">
                REVIEW REQUIRED
              </p>
              <p className="text-[11px] text-[#55635C] truncate hidden sm:block">
                {isEditing ? 'Make your edits and approve to finalize' : 'Review the CBT protocol draft to continue'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isEditing ? (
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true)
                  isEditingRef.current = true
                }}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#F4EFE6] text-[#55635C] border border-[#E8E4DA] text-xs font-semibold transition-colors shadow-2xs inline-flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#88978F]" />
                <span>Edit draft</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false)
                  isEditingRef.current = false
                  setEditedDraft(state.current_draft || '')
                }}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#F4EFE6] text-[#55635C] border border-[#E8E4DA] text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5 text-[#88978F]" />
                <span>Cancel edits</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleApprove}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#244F3B] hover:bg-[#1B3D2E] text-white text-xs font-semibold transition-colors shadow-xs inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Save edits & Approve' : 'Approve protocol →'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
