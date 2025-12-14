import { useState, useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Edit, AlertCircle } from 'lucide-react'
import axios from 'axios'

interface ProtocolViewerProps {
  sessionId: string
  onClose: () => void
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

export default function ProtocolViewer({ sessionId, onClose }: ProtocolViewerProps) {
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
        const streamUrl = `/api/protocols/${sessionId}/stream`
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
        `/api/protocols/${sessionId}/state`
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
        `/api/protocols/${sessionId}/approve`,
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
          `/api/protocols/${sessionId}/stream`
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
      await axios.post(`/api/protocols/${sessionId}/halt`)
      await fetchState()
    } catch (err: any) {
      console.error('Error halting:', err)
      alert(err.response?.data?.detail || 'Failed to halt workflow')
    } finally {
      setLoading(false)
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
      {/* Status and Scores */}
      <div className="flex items-center justify-between">
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
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <XCircle className="w-5 h-5" />
        </button>
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
      <div className="flex gap-3">
        {isHalted ? (
          <>
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
          </>
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
      </div>
    </div>
  )
}

