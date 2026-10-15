import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Clock,
  UserCheck,
  ArrowRight,
  History,
  Sparkles
} from 'lucide-react'
import { ProtocolEvent } from '../types'
import { getAgentDisplayName } from '../constants/agents'

interface LiveAgentFeedProps {
  events: ProtocolEvent[]
  onOpenTimeline?: () => void
}

export default function LiveAgentFeed({ events = [], onOpenTimeline }: LiveAgentFeedProps) {
  const shouldReduceMotion = useReducedMotion()
  const [now, setNow] = useState<number>(Date.now())
  const feedContainerRef = useRef<HTMLDivElement>(null)

  // Shared 1s interval driving relative times (C2)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Filter for displayable events (excluding raw tokens / internal node_starts)
  const displayEvents = useMemo(() => {
    return events.filter((e) =>
      ['message', 'score', 'decision', 'checkpoint', 'human_action', 'approval', 'error'].includes(e.type)
    )
  }, [events])

  // Automatically scroll to bottom as new events arrive
  useEffect(() => {
    if (feedContainerRef.current) {
      feedContainerRef.current.scrollTop = feedContainerRef.current.scrollHeight
    }
  }, [displayEvents.length])

  const formatRelTime = (ts: string) => {
    if (!ts) return 'Just now'
    const raw = ts.endsWith('Z') || ts.includes('+') ? ts : `${ts}Z`
    const eventTime = new Date(raw).getTime()
    if (isNaN(eventTime)) return 'Just now'
    const diffSec = Math.max(0, Math.floor((now - eventTime) / 1000))
    if (diffSec < 4) return 'Just now'
    if (diffSec < 60) return `${diffSec}s ago`
    return `${Math.floor(diffSec / 60)}m ago`
  }

  const renderEventIcon = (event: ProtocolEvent) => {
    switch (event.type) {
      case 'decision':
        return event.data?.route === 'revise' ? (
          <RotateCcw className="w-3.5 h-3.5 text-[#8C4A26]" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
        )
      case 'checkpoint':
        return <Clock className="w-3.5 h-3.5 text-[#2563EB]" />
      case 'approval':
        return <UserCheck className="w-3.5 h-3.5 text-[#244F3B]" />
      case 'score':
        return <ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />
      case 'error':
        return <AlertTriangle className="w-3.5 h-3.5 text-[#DC2626]" />
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-[#55635C]" />
    }
  }

  return (
    <div className="bg-white border border-[#E8E4DA] rounded-2xl p-2.5 sm:p-3 shadow-2xs flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header with Unified Count & Timeline link */}
      <div className="flex items-center justify-between pb-1.5 border-b border-[#F0ECE3] shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#244F3B]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#18221E]">Agent Activity</h3>
        </div>
        {onOpenTimeline && (
          <button
            type="button"
            onClick={onOpenTimeline}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#244F3B] hover:underline cursor-pointer"
            title="Open complete protocol timeline"
          >
            <History className="w-3 h-3" />
            <span>View full timeline</span>
          </button>
        )}
      </div>

      {/* Feed container: fully scrollable with complete event history */}
      <div
        ref={feedContainerRef}
        tabIndex={0}
        role="region"
        aria-label="Live agent feed"
        className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin pt-1.5 space-y-1.5 min-h-0 pr-0.5 focus:outline-none"
      >
        {displayEvents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[#A0ACA5] p-3">
            <MessageSquare className="w-5 h-5 stroke-1 mb-1.5 text-[#D8D2C4]" />
            <p>Agent observations and verdicts appear in real time.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {displayEvents.map((evt) => {
                const isDecision = evt.type === 'decision'
                const isCheckpoint = evt.type === 'checkpoint'

                return (
                  <motion.div
                    key={`${evt.seq}_${evt.ts}`}
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className={`p-2 rounded-lg text-xs transition-all ${
                      isDecision
                        ? evt.data?.route === 'revise'
                          ? 'bg-[#FDF6E2] border border-[#F6E0B5] text-[#8C4A26] font-medium'
                          : 'bg-[#EBF3EE] border border-[#C2DBCB] text-[#1E3D2F] font-medium'
                        : isCheckpoint
                        ? 'bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF]'
                        : 'bg-[#FAF8F5] border border-[#F0ECE3] text-[#18221E]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {renderEventIcon(evt)}
                        <span>{getAgentDisplayName(evt.agent)}</span>
                        {evt.to_agent && (
                          <>
                            <ArrowRight className="w-2.5 h-2.5 text-[#A0ACA5]" />
                            <span className="text-[#55635C] font-normal">{getAgentDisplayName(evt.to_agent)}</span>
                          </>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-[#55635C] shrink-0">
                        {formatRelTime(evt.ts)}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-[#55635C] leading-snug break-words">
                      {evt.text}
                    </p>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
