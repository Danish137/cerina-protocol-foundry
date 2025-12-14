import { useState, useEffect } from 'react'
import { Bot, MessageSquare, AlertTriangle, CheckCircle } from 'lucide-react'

interface AgentActivity {
  agent: string
  action: string
  timestamp: string
  priority?: string
}

interface AgentActivityFeedProps {
  sessionId?: string
}

export default function AgentActivityFeed({ sessionId }: AgentActivityFeedProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([])

  // Helper function to extract and add notes to activities
  const addNotesToActivities = (agentNotes: any[], timestamp?: string) => {
    if (!agentNotes || !Array.isArray(agentNotes)) {
      console.log('AgentActivityFeed: No agent notes or not an array:', agentNotes)
      return
    }
    
    console.log('AgentActivityFeed: Processing agent notes:', agentNotes.length, agentNotes)
    
    const humanNotes = agentNotes.filter((note: any) => {
      const isHuman = note?.agent_name === 'Human'
      if (isHuman) {
        console.log('AgentActivityFeed: Found Human note:', note)
      }
      return isHuman
    })
    const systemNotes = agentNotes.filter((note: any) => {
      const isSystem = note?.agent_name === 'System'
      if (isSystem) {
        console.log('AgentActivityFeed: Found System note:', note)
      }
      return isSystem
    })
    
    console.log('AgentActivityFeed: Human notes count:', humanNotes.length, 'System notes count:', systemNotes.length)
    
    // Add Human notes to activities
    humanNotes.forEach((note: any) => {
      const noteText = note?.note || note?.action || 'Protocol approved and finalized'
      setActivities((prev: AgentActivity[]) => {
        const exists = prev.some(
          a => a.agent === 'Human' && a.action === noteText
        )
        if (exists) {
          console.log('AgentActivityFeed: Human note already exists:', noteText)
          return prev
        }
        
        console.log('AgentActivityFeed: Adding Human note to activities:', noteText)
        const noteTimestamp = note?.timestamp || timestamp || new Date().toISOString()
        return [
          {
            agent: 'Human',
            action: noteText,
            timestamp: typeof noteTimestamp === 'string' ? noteTimestamp : new Date(noteTimestamp).toISOString(),
            priority: note?.priority || 'info',
          },
          ...prev.slice(0, 49),
        ]
      })
    })
    
    // Add System notes to activities
    systemNotes.forEach((note: any) => {
      const noteText = note?.note || note?.action || 'Protocol generation completed successfully'
      setActivities((prev: AgentActivity[]) => {
        const exists = prev.some(
          a => a.agent === 'System' && a.action === noteText
        )
        if (exists) {
          console.log('AgentActivityFeed: System note already exists:', noteText)
          return prev
        }
        
        console.log('AgentActivityFeed: Adding System note to activities:', noteText)
        const noteTimestamp = note?.timestamp || timestamp || new Date().toISOString()
        return [
          {
            agent: 'System',
            action: noteText,
            timestamp: typeof noteTimestamp === 'string' ? noteTimestamp : new Date(noteTimestamp).toISOString(),
            priority: note?.priority || 'info',
          },
          ...prev.slice(0, 49),
        ]
      })
    })
  }

  useEffect(() => {
    if (!sessionId) {
      setActivities([])
      return
    }

    // Fetch current state first to get any existing notes
    const fetchCurrentState = async () => {
      try {
        console.log('AgentActivityFeed: Fetching current state for session:', sessionId)
        const response = await fetch(`/api/protocols/${sessionId}/state`)
        const data = await response.json()
        console.log('AgentActivityFeed: Received state data:', data)
        const state = data.state || {}
        console.log('AgentActivityFeed: State keys:', Object.keys(state))
        const agentNotes = state.agent_notes || []
        console.log('AgentActivityFeed: Found agent notes array:', agentNotes)
        console.log('AgentActivityFeed: Agent notes count:', agentNotes.length)
        
        if (agentNotes.length > 0) {
          console.log('AgentActivityFeed: First note example:', agentNotes[0])
          console.log('AgentActivityFeed: All notes:', JSON.stringify(agentNotes, null, 2))
        }
        
        addNotesToActivities(agentNotes)
        
        // Also check if state is halted and add a message if no note exists
        if (state.halted || state.status === 'awaiting_approval') {
          const hasHaltNote = agentNotes.some((note: any) => 
            note.agent_name === 'Human' && 
            (note.note?.includes('halted') || note.note?.includes('review'))
          )
          if (!hasHaltNote) {
            setActivities((prev: AgentActivity[]) => {
              const exists = prev.some(
                a => a.agent === 'Human' && a.action === 'Workflow halted for review'
              )
              if (exists) return prev
              
              console.log('AgentActivityFeed: Adding halt message (no note found)')
              return [
                {
                  agent: 'Human',
                  action: 'Workflow halted for review',
                  timestamp: new Date().toISOString(),
                  priority: 'warning',
                },
                ...prev.slice(0, 49),
              ]
            })
          }
        }
      } catch (err) {
        console.error('AgentActivityFeed: Error fetching current state:', err)
      }
    }
    
    fetchCurrentState()
    
    // Set up polling to check for new notes periodically (especially after approval)
    const pollInterval = setInterval(() => {
      fetchCurrentState()
    }, 2000) // Poll every 2 seconds

    // Set up SSE stream
    console.log('AgentActivityFeed: Setting up SSE for session:', sessionId)
    const es = new EventSource(
      `/api/protocols/${sessionId}/stream`
    )
    
    es.onopen = () => {
      console.log('AgentActivityFeed: SSE connection opened')
    }

    // Handle state_update events (real-time agent activity)
    es.addEventListener('state_update', (event: MessageEvent) => {
      console.log('AgentActivityFeed: Received state_update:', event.data)
      try {
        const data = JSON.parse(event.data)
        
        // Handle state updates with or without node
        const state = data.state || {}
        const agentNotes = state.agent_notes || []
        
        // Always check for Human and System notes first (these are important)
        addNotesToActivities(agentNotes, data.timestamp)
        
        const humanNotes = agentNotes.filter((note: any) => note.agent_name === 'Human')
        const systemNotes = agentNotes.filter((note: any) => note.agent_name === 'System')
        
        // Only process node-based updates if node exists and is not 'current'
        if (data.node && data.node !== 'current') {
          // Extract agent activity from state update
          const nodeName = data.node
          
          // Map node names to agent names
          const agentMap: Record<string, string> = {
            'draft': 'Drafter',
            'safety_review': 'SafetyGuardian',
            'clinical_critique': 'ClinicalCritic',
            'supervisor': 'Supervisor',
          }
          
          // Skip if we already processed Human/System notes for this update
          if (humanNotes.length > 0 || systemNotes.length > 0) {
            // Human/System notes take priority, skip node-based activity
            return
          }
          
          let agentName = agentMap[nodeName] || nodeName
          
          // Get agent thoughts from agent_notes (most recent note from this agent)
          let agentThought = data.agent_thought || ''
          
          // Fallback to most recent note from this agent
          agentThought = agentNotes
            .filter((note: any) => note.agent_name === agentName)
            .slice(-1)[0]?.note || agentThought
          
          // Get action description from state and agent thought
          const status = state.status || 'working'
          let action = ''
          let priority: string = 'info'
          
          if (agentThought) {
            action = agentThought
            // Determine priority from note priority or status
            const recentNote = agentNotes
              .filter((note: any) => note.agent_name === agentName)
              .slice(-1)[0]
            priority = recentNote?.priority || 'info'
          } else {
            // Fallback to status-based action
            action = status === 'drafting' ? 'Creating draft...' :
                    status === 'reviewing' ? 'Reviewing safety...' :
                    status === 'critiquing' ? 'Evaluating quality...' :
                    status === 'deciding' ? 'Making decision...' :
                    `Executed ${nodeName}`
          }
          
          // Check for safety issues or warnings
          if (state.safety_score !== undefined && state.safety_score < 0.8) {
            priority = 'warning'
          }
          
          setActivities((prev: AgentActivity[]) => {
            // Avoid duplicates - check if same agent/action in last 3 entries
            const isDuplicate = prev.slice(0, 3).some(
              a => a.agent === agentName && a.action === action
            )
            if (isDuplicate) {
              return prev
            }
            
            return [
              {
                agent: agentName,
                action: action,
                timestamp: data.timestamp || new Date().toISOString(),
                priority: priority,
              },
              ...prev.slice(0, 49), // Keep last 50 activities
            ]
          })
        }
      } catch (err) {
        console.error('Error parsing activity:', err)
      }
    })

    // Also handle halted events
    es.addEventListener('halted', (event: MessageEvent) => {
      console.log('AgentActivityFeed: Workflow halted')
      try {
        const data = JSON.parse(event.data)
        const state = data.state || {}
        
        // Extract agent notes from halted state
        const agentNotes = state.agent_notes || []
        
        // Check for Human and System notes
        addNotesToActivities(agentNotes, data.timestamp)
        
        const humanNotes = agentNotes.filter((note: any) => note.agent_name === 'Human')
        const systemNotes = agentNotes.filter((note: any) => note.agent_name === 'System')
        
        // Add halted message if no specific notes found
        if (humanNotes.length === 0 && systemNotes.length === 0) {
          setActivities((prev: AgentActivity[]) => [
            {
              agent: 'System',
              action: 'Workflow paused for human review',
              timestamp: data.timestamp || new Date().toISOString(),
              priority: 'warning',
            },
            ...prev.slice(0, 49),
          ])
        }
      } catch (err) {
        console.error('Error parsing halted event:', err)
      }
    })

    // Also handle generic messages (fallback)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.node && data.node !== 'current') {
          const nodeName = data.node
          const stateData = data.state || {}
          const agentMap: Record<string, string> = {
            'draft': 'Drafter',
            'safety_review': 'SafetyGuardian',
            'clinical_critique': 'ClinicalCritic',
            'supervisor': 'Supervisor',
          }
          
          // Check for Human or System notes
          const agentNotes = stateData.agent_notes || []
          const humanNote = agentNotes.find((note: any) => note.agent_name === 'Human')
          const systemNote = agentNotes.find((note: any) => note.agent_name === 'System')
          
          let agentName = agentMap[nodeName] || nodeName
          let agentThought = `Executed ${nodeName} node`
          
          if (humanNote) {
            agentName = 'Human'
            agentThought = humanNote.note || agentThought
          } else if (systemNote) {
            agentName = 'System'
            agentThought = systemNote.note || agentThought
          } else {
            // Try to get agent thought from notes
            agentThought = agentNotes
              .filter((note: any) => note.agent_name === agentName)
              .slice(-1)[0]?.note || agentThought
          }
          
          setActivities((prev: AgentActivity[]) => [
            {
              agent: agentName,
              action: agentThought,
              timestamp: data.timestamp || new Date().toISOString(),
              priority: 'info',
            },
            ...prev.slice(0, 49),
          ])
        }
      } catch (err) {
        console.error('Error parsing activity:', err)
      }
    }

    es.addEventListener('complete', (event: MessageEvent) => {
      console.log('AgentActivityFeed: Received complete event:', event.data)
      try {
        const data = JSON.parse(event.data)
        const state = data.state || {}
        
        // Extract agent notes from completed state
        const agentNotes = state.agent_notes || []
        
        // Check for Human and System notes in the final state
        addNotesToActivities(agentNotes, data.timestamp)
      } catch (err) {
        console.error('Error parsing complete event:', err)
      }
      // Close connection after receiving complete event
      es.close()
    })

    es.onerror = (err) => {
      console.error('SSE error:', err)
      es.close()
    }

    return () => {
      clearInterval(pollInterval)
      if (es.readyState !== EventSource.CLOSED) {
        es.close()
      }
    }
  }, [sessionId])

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'Drafter':
        return <MessageSquare className="w-4 h-4 text-blue-400" />
      case 'SafetyGuardian':
        return <AlertTriangle className="w-4 h-4 text-red-400" />
      case 'ClinicalCritic':
        return <CheckCircle className="w-4 h-4 text-green-400" />
      case 'Supervisor':
        return <Bot className="w-4 h-4 text-purple-400" />
      case 'System':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />
      case 'Human':
        return <CheckCircle className="w-4 h-4 text-blue-500" />
      default:
        return <Bot className="w-4 h-4 text-slate-400" />
    }
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'critical':
        return 'border-red-500 bg-red-900/10'
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/10'
      default:
        return 'border-slate-700 bg-slate-800/30'
    }
  }

  if (!sessionId) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        Start a protocol generation to see agent activity
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        Waiting for agent activity...
      </div>
    )
  }

  return (
    <div 
      className="space-y-3" 
      style={{ 
        maxHeight: '600px', 
        minHeight: '200px',
        overflowY: 'auto', 
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
        isolation: 'isolate',
        scrollbarWidth: 'thin'
      }}
      onWheel={(e) => {
        // Prevent page scroll when scrolling the feed
        const target = e.currentTarget as HTMLElement
        const isScrolledToTop = target.scrollTop <= 0
        const isScrolledToBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 1
        
        // Only prevent page scroll if we're not at the boundaries
        if (!isScrolledToTop && !isScrolledToBottom) {
          // We're scrolling within the feed, prevent page scroll
          e.stopPropagation()
        }
        // If at boundaries, allow the event to bubble for page scrolling
      }}
    >
      {activities.map((activity: AgentActivity, idx: number) => (
        <div
          key={idx}
          className={`p-3 rounded-lg border ${getPriorityColor(activity.priority)} transition-all`}
        >
          <div className="flex items-start gap-2">
            {getAgentIcon(activity.agent)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-white">
                  {activity.agent}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(activity.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-slate-300 break-words">
                {activity.action}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

