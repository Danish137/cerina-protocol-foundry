import { useState, useEffect, useRef } from 'react'
import { CheckCircle, Edit, AlertCircle, Download } from 'lucide-react'
import axios from 'axios'
import jsPDF from 'jspdf'
import API_BASE_URL from '../config'

interface ProtocolViewerProps {
  sessionId: string
}

interface ProtocolState {
  status: string
  current_draft?: string
  safety_score?: number
  empathy_score?: number
  clinical_score?: number
  halted?: boolean
  human_approved?: boolean
  iteration_count?: number
  active_agent?: string
}

export default function ProtocolViewer({ sessionId }: ProtocolViewerProps) {
  const [state, setState] = useState<ProtocolState | null>(null)
  const [editedDraft, setEditedDraft] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const isEditingRef = useRef(false) // Track editing state to prevent overwrites

  useEffect(() => {
    let timer: number | null = null
    let eventSource: EventSource | null = null

    const setup = () => {
      console.log('ProtocolViewer: Setting up for session:', sessionId)
      // Fetch initial state first
      fetchState().then(() => {
        // Set up SSE stream for real-time updates after initial state is loaded
        console.log('Setting up SSE stream for session:', sessionId)
        const streamUrl = `${API_BASE_URL}/api/protocols/${sessionId}/stream`
        console.log('SSE URL:', streamUrl)
        eventSource = new EventSource(streamUrl)

        eventSource.onopen = () => {
          console.log('SSE connection opened')
        }

      const handleStateUpdate = (raw: string) => {
        try {
          const data = JSON.parse(raw)
          if (data.state) {
            const newState = data.state
            setState(newState)
            // Only update editedDraft if we're NOT in editing mode
            // Use ref to check current editing state to avoid stale closure issues
            if (newState.current_draft && !isEditingRef.current) {
              setEditedDraft(newState.current_draft)
            }
            console.log('State updated:', {
              status: newState.status,
              hasDraft: !!newState.current_draft,
              draftLength: newState.current_draft?.length || 0,
              activeAgent: newState.active_agent,
              isEditing: isEditing
            })
          }
        } catch (err) {
          console.error('Error parsing SSE data:', err)
        }
      }

      eventSource.addEventListener('state_update', (event: MessageEvent) => {
        console.log('Received state_update event:', event.data)
        handleStateUpdate(event.data)
      })

      eventSource.addEventListener('halted', (event: MessageEvent) => {
        console.log('Received halted event:', event.data)
        handleStateUpdate(event.data)
        // Don't close connection - keep it open to show halted state
      })

      eventSource.addEventListener('complete', (event: MessageEvent) => {
        console.log('Received complete event:', event.data)
        handleStateUpdate(event.data)
        // Close connection after receiving complete event
        eventSource?.close()
      })

      // Also handle generic messages as fallback
      eventSource.onmessage = (event) => {
        console.log('Received generic message:', event.data)
        handleStateUpdate(event.data)
      }

      eventSource.onerror = (err) => {
        console.error('SSE error:', err)
        eventSource?.close()
      }

        eventSourceRef.current = eventSource
      })
    }

    // Small delay to ensure state is initialized
    timer = window.setTimeout(setup, 500)

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
        eventSourceRef.current.close()
      }
    }
  }, [sessionId]) // Removed editedDraft and isEditing to prevent re-initialization on every edit

  const fetchState = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/protocols/${sessionId}/state`
      )
      const stateData = response.data.state
      if (stateData) {
        setState(stateData)
        if (stateData.current_draft) {
          setEditedDraft(stateData.current_draft)
        }
        console.log('Fetched state:', {
          status: stateData.status,
          hasDraft: !!stateData.current_draft,
          draftLength: stateData.current_draft?.length || 0
        })
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
      
      // Only send approved_content if it's different from current draft (i.e., actually edited)
      const hasEdits = isEditing && content && content.trim() !== currentDraft.trim()
      const requestBody = hasEdits ? { approved_content: content } : {}
      
      console.log('Approving protocol:', {
        isEditing,
        hasEdits,
        contentLength: content?.length || 0,
        currentDraftLength: currentDraft.length
      })
      
      const response = await axios.post(
        `${API_BASE_URL}/api/protocols/${sessionId}/approve`,
        requestBody,
        { headers: { 'Content-Type': 'application/json' } }
      )
      
      console.log('Approval successful:', response.data)
      setIsEditing(false)
      isEditingRef.current = false
      
      // Fetch updated state which should include the approval note
      await fetchState()
      
      // Close and reconnect stream to get finalization updates
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      
      // Small delay then reconnect stream to see finalization
      setTimeout(() => {
        const newEventSource = new EventSource(
          `${API_BASE_URL}/api/protocols/${sessionId}/stream`
        )
        newEventSource.onopen = () => {
          console.log('SSE reconnected after approval')
        }
        newEventSource.addEventListener('state_update', (event: MessageEvent) => {
          const data = JSON.parse(event.data)
          if (data.state) {
            setState(data.state)
          }
        })
        newEventSource.addEventListener('complete', (event: MessageEvent) => {
          const data = JSON.parse(event.data)
          if (data.state) {
            setState(data.state)
          }
          newEventSource.close()
        })
        eventSourceRef.current = newEventSource
      }, 500)
    } catch (err: any) {
      console.error('Error approving:', err)
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
      console.error('Error halting:', err)
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
      const margin = 40
      const maxWidth = pageWidth - margin * 2
      const lineHeight = 16

      let cursorY = 60

      // Title
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text('CBT Protocol', margin, cursorY)
      cursorY += 24

      // Generated timestamp
      const now = new Date()
      const generatedAt = now.toLocaleString()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Generated: ${generatedAt}`, margin, cursorY)
      cursorY += 18

      // Divider
      doc.setDrawColor(180)
      doc.line(margin, cursorY, pageWidth - margin, cursorY)
      cursorY += 24

      // Body text
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)

      const lines = doc.splitTextToSize(content, maxWidth) as string[]

      lines.forEach((line: string) => {
        const text = line

        if (cursorY > pageHeight - margin) {
          doc.addPage()
          cursorY = margin
        }

        doc.text(text, margin, cursorY)
        cursorY += lineHeight
      })

      const fileName = `cbt-protocol-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`
      doc.save(fileName)
    } catch (err) {
      console.error('Error exporting PDF:', err)
      alert('Failed to export PDF. Please try again.')
    }
  }

  if (!state) {
    return (
      <div className="text-center py-8 text-slate-400">
        Loading protocol state...
      </div>
    )
  }

  const isHalted = state.halted || state.status === 'awaiting_approval'
  const scores = [
    { label: 'Safety', value: state.safety_score, color: 'green' },
    { label: 'Empathy', value: state.empathy_score, color: 'blue' },
    { label: 'Clinical', value: state.clinical_score, color: 'purple' },
  ].filter(s => s.value !== undefined && s.value !== null)

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center gap-3">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          state.status === 'completed' ? 'bg-green-900/30 text-green-300' :
          isHalted ? 'bg-yellow-900/30 text-yellow-300' :
          'bg-blue-900/30 text-blue-300'
        }`}>
          {state.status}
        </span>
        {state.iteration_count !== undefined && (
          <span className="text-sm text-slate-400">
            Iteration {state.iteration_count}
          </span>
        )}
      </div>

      {/* Quality Scores */}
      {scores.length > 0 && (
        <div className="flex gap-4">
          {scores.map(({ label, value, color }) => (
            <div key={label} className="flex-1">
              <div className="text-xs text-slate-400 mb-1">{label}</div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-${color}-500`}
                  style={{ width: `${(value! * 100)}%` }}
                />
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {(value! * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Draft Content */}
      <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
        {isHalted && (
          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-yellow-300 font-medium mb-1">Awaiting Human Approval</p>
              <p className="text-yellow-200/80 text-sm">
                Review the draft below. You can edit it or approve as-is.
              </p>
            </div>
          </div>
        )}

        {isEditing ? (
          <textarea
            value={editedDraft}
            onChange={(e) => {
              setEditedDraft(e.target.value)
              // Prevent state updates from overwriting while editing
            }}
            onFocus={() => {
              // Mark that we're editing to prevent overwrites
              console.log('Textarea focused - editing mode active')
            }}
            className="w-full h-96 px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        ) : (
          <div className="prose prose-invert max-w-none">
            {state.current_draft ? (
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans bg-slate-800/50 p-4 rounded border border-slate-700">
                {state.current_draft}
              </pre>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <div className="animate-pulse">Waiting for agents to generate draft...</div>
                {state.active_agent && (
                  <div className="text-xs mt-2 text-slate-500">
                    {state.active_agent} is working...
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        {isHalted ? (
          <div className="flex flex-wrap gap-3">
            {!isEditing ? (
              <button
                onClick={() => {
                  setIsEditing(true)
                  isEditingRef.current = true
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                <Edit className="w-4 h-4" />
                Edit
              </button>
            ) : (
              <button
                onClick={() => {
                  setIsEditing(false)
                  isEditingRef.current = false
                  setEditedDraft(state.current_draft || '')
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleApprove}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 text-white rounded-lg transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              {isEditing ? 'Save & Approve' : 'Approve'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleHalt}
            disabled={loading || state.status === 'completed'}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-700 text-white rounded-lg transition-colors"
          >
            <AlertCircle className="w-4 h-4" />
            Halt for Review
          </button>
        )}

        <button
          onClick={handleExportPdf}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>
    </div>
  )
}

