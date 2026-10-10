import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  ListTree,
  Bot,
} from 'lucide-react'
import { Phase, ProtocolState } from '../types'
import { AGENTS_LIST, normalizeAgentId } from '../agents'

interface AgentRosterProps {
  phase: Phase
  state: ProtocolState | null
  isExplainer?: boolean
  onHeadingClick?: (headingText: string) => void
}

type AgentStatus = 'idle' | 'working' | 'done' | 'flagged'

export default function AgentRoster({
  phase,
  state,
  isExplainer = false,
  onHeadingClick,
}: AgentRosterProps) {
  const [rosterExpanded, setRosterExpanded] = useState(false)

  const activeNormalizedId = useMemo(() => {
    if (phase !== 'generating') return undefined
    if (state?.active_agent) {
      return normalizeAgentId(state.active_agent)
    }
    return 'drafter'
  }, [phase, state?.active_agent])

  const getAgentStatus = (agentId: string): AgentStatus => {
    if (isExplainer || phase === 'idle') return 'idle'

    if (agentId === 'human') {
      if (phase === 'approved') return 'done'
      if (phase === 'review' || phase === 'editing' || phase === 'approving') return 'working'
      return 'idle'
    }

    if (phase === 'generating') {
      if (activeNormalizedId === agentId) return 'working'

      // Order: drafter -> safety_guardian -> clinical_critic -> supervisor
      const order = ['drafter', 'safety_guardian', 'clinical_critic', 'supervisor']
      const activeIdx = order.indexOf(activeNormalizedId || 'drafter')
      const thisIdx = order.indexOf(agentId)

      if (thisIdx < activeIdx) {
        if (agentId === 'safety_guardian' && state?.safety_score !== undefined && state.safety_score < 0.8) {
          return 'flagged'
        }
        return 'done'
      }
      return 'idle'
    }

    if (phase === 'review' || phase === 'editing' || phase === 'approving' || phase === 'approved') {
      if (agentId === 'safety_guardian' && state?.safety_score !== undefined && state.safety_score < 0.8) {
        return 'flagged'
      }
      return 'done'
    }

    return 'idle'
  }

  // Extract document outline headings if draft exists (Section 10 P2)
  const headings = useMemo(() => {
    if (!state?.current_draft) return []
    const lines = state.current_draft.split('\n')
    const list: { level: number; text: string }[] = []
    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.*)$/)
      if (match) {
        const text = match[2].replace(/[*_`]/g, '').trim()
        if (text && !text.startsWith('<!--')) {
          list.push({ level: match[1].length, text })
        }
      }
    }
    return list.slice(0, 7) // Keep compact to fit without scroll
  }, [state?.current_draft])

  const isPostDraft = phase === 'review' || phase === 'editing' || phase === 'approving' || phase === 'approved'

  return (
    <motion.div
      layoutId="roster"
      className="bg-white border border-[#E8E4DA] rounded-xl p-3.5 sm:p-4 shadow-2xs space-y-3 shrink-0 select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-[#EBF3EE] text-[#244F3B]">
            <Bot className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-semibold text-[#18221E]">
            {isExplainer
              ? 'Collaborative Review Team'
              : isPostDraft
              ? '4 Checks Complete'
              : 'Agent Review Roster'}
          </h3>
        </div>

        {isPostDraft ? (
          <button
            type="button"
            onClick={() => setRosterExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#244F3B] hover:underline cursor-pointer"
          >
            <span>{rosterExpanded ? 'Hide' : 'Details'}</span>
            {rosterExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ) : (
          <span className="text-[10px] font-mono text-[#88978F] bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#E8E4DA]">
            {phase === 'generating' ? 'Live pipeline' : 'Multidisciplinary'}
          </span>
        )}
      </div>

      {/* Roster list: always visible in idle/generating, expandable in post-draft */}
      <AnimatePresence initial={false}>
        {(!isPostDraft || rosterExpanded) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1.5"
          >
            {AGENTS_LIST.map((agent, index) => {
              const status = getAgentStatus(agent.id)
              const isWorking = status === 'working'
              const isDone = status === 'done'
              const isFlagged = status === 'flagged'
              const Icon = agent.icon

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className={`p-2 rounded-lg border transition-all ${
                    isWorking
                      ? 'bg-[#EBF3EE]/70 border-[#CDE0D4] ring-1 ring-[#CDE0D4]'
                      : isFlagged
                      ? 'bg-[#FBF5EB] border-[#EEDDC3]'
                      : isDone
                      ? 'bg-white border-[#E8E4DA]'
                      : 'bg-[#FAF8F5]/80 border-transparent hover:border-[#E8E4DA]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`p-1 rounded-md shrink-0 transition-colors ${
                          isWorking
                            ? 'bg-[#244F3B] text-white'
                            : isDone
                            ? 'bg-[#EBF3EE] text-[#244F3B]'
                            : isFlagged
                            ? 'bg-[#F4DEC2] text-[#8C5921]'
                            : 'bg-white text-[#7E8F87] border border-[#E8E4DA]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-[#18221E] truncate leading-tight">
                          {agent.label}
                        </h4>
                        <p className="text-[10.5px] text-[#55635C] truncate leading-snug">
                          {agent.role}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge: Active agent MUST show "Working" with pulse (Section 3) */}
                    <div className="shrink-0 flex items-center">
                      {isWorking && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#244F3B] text-white animate-pulse">
                          <Clock className="w-2.5 h-2.5 animate-spin" />
                          <span>Working</span>
                        </span>
                      )}
                      {isDone && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#EBF3EE] text-[#244F3B]">
                          <CheckCircle2 className="w-3 h-3 text-[#244F3B]" />
                          <span>Done</span>
                        </span>
                      )}
                      {isFlagged && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5EB] text-[#8C5921] border border-[#EEDDC3]">
                          <AlertTriangle className="w-3 h-3 text-[#D4882C]" />
                          <span>Notes</span>
                        </span>
                      )}
                      {status === 'idle' && !isExplainer && (
                        <span className="text-[10px] font-mono text-[#88978F]">Idle</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document Outline with Scroll-Spy triggers (Section 10 P2) */}
      {isPostDraft && headings.length > 0 && (
        <div className="pt-2 border-t border-[#F0ECE3] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#55635C]">
            <ListTree className="w-3 h-3 text-[#244F3B]" />
            <span>Document Outline</span>
          </div>
          <div className="space-y-1">
            {headings.map((heading, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onHeadingClick?.(heading.text)}
                className={`w-full text-left truncate rounded px-1.5 py-1 text-xs text-[#55635C] hover:text-[#18221E] hover:bg-[#FAF8F5] transition-colors cursor-pointer ${
                  heading.level === 1 ? 'font-semibold text-[#18221E]' : 'pl-3 text-[11px]'
                }`}
                title={heading.text}
              >
                {heading.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
