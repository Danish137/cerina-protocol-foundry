import { useState, useEffect } from 'react'
import { Activity, Clock, PauseCircle } from 'lucide-react'
import API_BASE_URL from '../config'

interface AgentActivity {
  agent: string
  action: string
  timestamp: string
  priority?: string
}

interface AgentActivityFeedProps {
  sessionId?: string
  isAwaitingApproval?: boolean
}

export default function AgentActivityFeed({ sessionId, isAwaitingApproval }: AgentActivityFeedProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([])

  const addNotesToActivities = (agentNotes: any[], timestamp?: string) => {
    if (!agentNotes || !Array.isArray(agentNotes)) return

    agentNotes.forEach((note: any) => {
      const agent = note?.agent_name || 'System'
      const noteText = note?.note || note?.action || ''
      if (!noteText) return

      setActivities((prev: AgentActivity[]) => {
        // Strict deduplication check: match agent and normalized noteText
        const exists = prev.some(
          (a) => a.agent === agent && a.action.trim().toLowerCase() === noteText.trim().toLowerCase()
        )
        if (exists) return prev

        const noteTimestamp = note?.timestamp || timestamp || new Date().toISOString()
        return [
          ...prev,
          {
            agent,
            action: noteText,
            timestamp: typeof noteTimestamp === 'string' ? noteTimestamp : new Date(noteTimestamp).toISOString(),
            priority: note?.priority || 'info',
          },
        ].slice(-50)
      })
    })
  }

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

        // Only add human paused notice if the state is halted and not already recorded in activities
        if (state.halted || state.status === 'awaiting_approval') {
          setActivities((prev: AgentActivity[]) => {
            const hasPauseNotice = prev.some(
              (a) =>
                a.agent === 'Human' &&
                (a.action.toLowerCase().includes('paused') ||
                 a.action.toLowerCase().includes('halted') ||
                 a.action.toLowerCase().includes('approval') ||
                 a.action.toLowerCase().includes('review'))
            )
            if (hasPauseNotice) return prev

            return [
              ...prev,
              {
                agent: 'Human',
                action: 'Workflow paused for your review',
                timestamp: new Date().toISOString(),
                priority: 'warning',
              },
            ]
          })
        }
      } catch (err) {
        console.error('Error fetching current state:', err)
      }
    }

    fetchCurrentState()

    const pollInterval = setInterval(() => {
      fetchCurrentState()
    }, 2000)

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
          let agentThought = data.agent_thought || ''

          agentThought =
            agentNotes
              .filter((note: any) => note.agent_name === agentName)
              .slice(-1)[0]?.note || agentThought || `Executed ${nodeName} stage`

          const priority = data.priority || 'info'

          setActivities((prev: AgentActivity[]) => {
            const exists = prev.some(
              (a) =>
                a.agent === agentName &&
                a.action.trim().toLowerCase() === agentThought.trim().toLowerCase()
            )
            if (exists) return prev

            return [
              ...prev,
              {
                agent: agentName,
                action: agentThought,
                timestamp: data.timestamp || new Date().toISOString(),
                priority,
              },
            ].slice(-50)
          })
        }
      } catch (err) {
        console.error('Error parsing state_update:', err)
      }
    })

    es.addEventListener('halted', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        const timestamp = data.timestamp || new Date().toISOString()
        setActivities((prev: AgentActivity[]) => {
          const exists = prev.some(
            (a) =>
              a.agent === 'Human' &&
              (a.action.toLowerCase().includes('paused') ||
               a.action.toLowerCase().includes('halted') ||
               a.action.toLowerCase().includes('approval') ||
               a.action.toLowerCase().includes('review'))
          )
          if (exists) return prev

          return [
            ...prev,
            {
              agent: 'Human',
              action: data.message || 'Workflow paused for your review',
              timestamp,
              priority: 'warning',
            },
          ]
        })
      } catch (err) {
        console.error('Error parsing halted event:', err)
      }
    })

    es.addEventListener('complete', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        const state = data.state || {}
        const agentNotes = state.agent_notes || []
        addNotesToActivities(agentNotes, data.timestamp)
      } catch (err) {
        console.error('Error parsing complete event:', err)
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
      case 'System':
        return 'System'
      default:
        return agent
    }
  }

  const getNodeColor = (agent: string, priority?: string) => {
    if (priority === 'warning' || agent === 'Human') {
      return { dot: 'bg-[#D4882C]', ring: 'ring-[#F4DEC2]' }
    }
    switch (agent) {
      case 'Drafter':
      case 'SafetyGuardian':
        return { dot: 'bg-[#244F3B]', ring: 'ring-[#D1E2D7]' }
      case 'ClinicalCritic':
        return { dot: 'bg-[#2B6CB0]', ring: 'ring-[#D4E4F5]' }
      case 'Supervisor':
        return { dot: 'bg-[#553C9A]', ring: 'ring-[#E9D8FD]' }
      default:
        return { dot: 'bg-[#718096]', ring: 'ring-[#E2E8F0]' }
    }
  }

  const formatTimestamp = (timestampStr: string) => {
    try {
      const date = new Date(timestampStr)
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ''
    }
  }

  if (!sessionId) {
    return (
      <div className="p-6 text-center text-[#88978F] text-xs">
        <Activity className="w-5 h-5 mx-auto mb-2 text-[#A4B3AB]" />
        <p className="font-medium text-[#55635C] mb-1">Workflow trace is idle</p>
        <p>Start a protocol generation to see real-time agent evaluations and audit log.</p>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="p-6 text-center text-[#88978F] text-xs">
        <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#EBF3EE] text-[#244F3B] mb-2 animate-spin">
          <Clock className="w-3.5 h-3.5" />
        </div>
        <p className="font-medium text-[#55635C] mb-1">Awaiting trace events</p>
        <p>Agents are initializing session...</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Activity Timeline List */}
      <div className="relative pl-3 space-y-3 before:absolute before:left-4 before:top-2 before:bottom-2 before:w-[1px] before:bg-[#E8E4DA] max-h-[380px] overflow-y-auto pr-1">
        {activities.map((activity, index) => {
          const colors = getNodeColor(activity.agent, activity.priority)
          const agentTitle = getAgentLabel(activity.agent)
          const time = formatTimestamp(activity.timestamp)

          return (
            <div key={`${activity.timestamp}-${index}`} className="relative pl-5 text-xs group">
              {/* Timeline Node */}
              <div
                className={`absolute -left-1 top-1 w-2.5 h-2.5 rounded-full ${colors.dot} ring-4 ${colors.ring}`}
              />

              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="font-semibold text-[#18221E] text-xs">
                  {agentTitle}
                </span>
                {time && (
                  <span className="text-[10px] font-mono text-[#88978F] shrink-0">
                    {time}
                  </span>
                )}
              </div>

              <p className="text-[#55635C] leading-relaxed text-[11.5px]">
                {activity.action}
              </p>
            </div>
          )
        })}
      </div>

      {/* Human Review Waiting Banner at bottom of trace (Informational only) */}
      {isAwaitingApproval && (
        <div className="p-3.5 rounded-xl bg-[#FBF5EB] border border-[#EEDDC3] flex items-center gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="p-1.5 rounded-full bg-[#F4DEC2] text-[#8C5921] shrink-0">
            <PauseCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#8C5921] truncate">
              Waiting for your approval
            </p>
            <p className="text-[11px] text-[#A6753B] truncate">
              Review the draft to continue.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
