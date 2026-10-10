import { useState, useEffect, useRef } from 'react'
import {
  Activity,
  ArrowDown,
  FileText,
  ShieldCheck,
  MessageSquare,
  Bot,
  UserCheck,
} from 'lucide-react'
import API_BASE_URL from '../config'
import { AgentActivity } from '../types'

interface AgentActivityFeedProps {
  sessionId?: string
  isAwaitingApproval?: boolean
}

function getRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
    if (diffSeconds < 5) return 'just now'
    if (diffSeconds < 60) return `${diffSeconds}s ago`
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    return `${diffHours}h ago`
  } catch {
    return ''
  }
}

export default function AgentActivityFeed({
  sessionId,
  isAwaitingApproval = false,
}: AgentActivityFeedProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Helper to add notes with deduplication
  const addNotesToActivities = (agentNotes: any[], fallbackTimestamp?: string) => {
    if (!agentNotes || !Array.isArray(agentNotes)) return

    setActivities((prev) => {
      let updated = [...prev]

      agentNotes.forEach((note) => {
        const agent = note.agent_name || 'System'
        const rawAction = note.note || note.action || ''
        const timestamp = note.timestamp || fallbackTimestamp || new Date().toISOString()
        const priority = note.priority || 'info'

        if (!rawAction) return

        // Deduplication check: ignore if an entry with exact same agent and text exists
        const exists = updated.some(
          (a) =>
            a.agent === agent &&
            a.action.trim().toLowerCase() === rawAction.trim().toLowerCase()
        )

        if (!exists) {
          updated.push({
            agent,
            action: rawAction,
            timestamp,
            priority,
          })
        }
      })

      // Sort chronologically
      updated.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )

      return updated.slice(-60) // Keep last 60 activities
    })
  }

  // Handle SSE and Polling
  useEffect(() => {
    if (!sessionId) {
      setActivities([])
      return
    }

    const fetchCurrentState = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/protocols/${sessionId}/state`)
        const data = await response.json()
        const state = data.state || {}
        const agentNotes = state.agent_notes || []

        addNotesToActivities(agentNotes)
      } catch (err) {
        console.error('Error fetching state in activity feed:', err)
      }
    }

    // Initial state fetch + 2s polling
    fetchCurrentState()
    const pollInterval = setInterval(fetchCurrentState, 2000)

    // SSE connection
    const es = new EventSource(`${API_BASE_URL}/api/protocols/${sessionId}/stream`)

    es.addEventListener('state_update', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        const state = data.state || {}
        const agentNotes = state.agent_notes || []

        addNotesToActivities(agentNotes, data.timestamp)

        if (data.node && data.node !== 'current') {
          const nodeName = data.node
          const agentMap: Record<string, string> = {
            draft: 'Drafter',
            safety_review: 'SafetyGuardian',
            clinical_critique: 'ClinicalCritic',
            supervisor: 'Supervisor',
          }

          const agentName = agentMap[nodeName] || nodeName
          let thought = data.agent_thought

          if (thought) {
            setActivities((prev) => {
              const exists = prev.some(
                (a) =>
                  a.agent === agentName &&
                  a.action.trim().toLowerCase() === thought.trim().toLowerCase()
              )
              if (exists) return prev

              const next = [
                ...prev,
                {
                  agent: agentName,
                  action: thought,
                  timestamp: data.timestamp || new Date().toISOString(),
                  priority: data.priority || 'info',
                },
              ]
              return next.slice(-60)
            })
          }
        }
      } catch (err) {
        console.error('Error parsing activity update:', err)
      }
    })

    es.addEventListener('complete', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        const state = data.state || {}
        addNotesToActivities(state.agent_notes || [], data.timestamp)
      } catch (err) {
        console.error('Error parsing complete event in feed:', err)
      }
      es.close()
    })

    es.onerror = () => {
      es.close()
    }

    return () => {
      clearInterval(pollInterval)
      if (es.readyState !== EventSource.CLOSED) {
        es.close()
      }
    }
  }, [sessionId])

  // Auto-scroll to bottom if not user-scrolled
  useEffect(() => {
    if (!isScrolledUp && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [activities, isScrolledUp])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    setIsScrolledUp(!atBottom)
  }

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      setIsScrolledUp(false)
    }
  }

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'Drafter':
        return <FileText className="w-3.5 h-3.5 text-[#244F3B]" />
      case 'SafetyGuardian':
        return <ShieldCheck className="w-3.5 h-3.5 text-[#D4882C]" />
      case 'ClinicalCritic':
        return <MessageSquare className="w-3.5 h-3.5 text-[#2B6CB0]" />
      case 'Supervisor':
        return <Bot className="w-3.5 h-3.5 text-[#553C9A]" />
      case 'Human':
        return <UserCheck className="w-3.5 h-3.5 text-[#8C5921]" />
      default:
        return <Activity className="w-3.5 h-3.5 text-[#7E8F87]" />
    }
  }

  const getAgentLabel = (agent: string) => {
    switch (agent) {
      case 'Drafter':
        return 'Clinical Drafter'
      case 'SafetyGuardian':
        return 'Safety Guardian'
      case 'ClinicalCritic':
        return 'Clinical Critic'
      case 'Supervisor':
        return 'Workflow Supervisor'
      case 'Human':
        return 'Human Reviewer'
      default:
        return agent
    }
  }

  return (
    <div className="relative flex flex-col h-full bg-white border border-[#E8E4DA] rounded-xl overflow-hidden shadow-2xs">
      {/* Trace Header */}
      <div className="px-4 py-2.5 bg-[#FAF8F5] border-b border-[#E8E4DA] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#244F3B]" />
          <span className="text-xs font-semibold text-[#18221E]">
            Activity Trace ({activities.length})
          </span>
        </div>
        {isAwaitingApproval && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#FBF5EB] text-[#8C5921] border border-[#EEDDC3]">
            Awaiting Approval
          </span>
        )}
      </div>

      {/* Internal Scrollable Feed with Isolated Wheel Scrolling */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[140px] max-h-[300px]"
      >
        {activities.length === 0 ? (
          <div className="h-28 flex flex-col items-center justify-center text-center text-xs text-[#88978F]">
            <p>Initializing agent trace…</p>
          </div>
        ) : (
          activities.map((act, idx) => {
            const timeAgo = getRelativeTime(act.timestamp)
            const isCritical = act.priority === 'critical'
            const isWarning = act.priority === 'warning'

            return (
              <div
                key={`${act.timestamp}-${idx}`}
                className={`p-2.5 rounded-lg border text-xs transition-colors ${
                  isCritical
                    ? 'bg-red-50/70 border-red-200 text-red-900'
                    : isWarning
                    ? 'bg-[#FBF5EB]/70 border-[#EEDDC3] text-[#8C5921]'
                    : 'bg-[#FAF8F5]/80 border-[#E8E4DA] text-[#18221E]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                    {getAgentIcon(act.agent)}
                    <span>{getAgentLabel(act.agent)}</span>
                  </div>
                  <span
                    className="text-[10px] font-mono text-[#88978F] cursor-help"
                    title={new Date(act.timestamp).toLocaleTimeString()}
                  >
                    {timeAgo}
                  </span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-[#55635C]">
                  {act.action}
                </p>
              </div>
            )
          })
        )}
      </div>

      {/* "Jump to latest" floating pill if user scrolled up */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#18221E] text-white text-[10px] font-semibold rounded-full shadow-md hover:bg-black transition-transform active:scale-95 flex items-center gap-1 z-20"
        >
          <ArrowDown className="w-3 h-3" />
          <span>Jump to latest</span>
        </button>
      )}
    </div>
  )
}
