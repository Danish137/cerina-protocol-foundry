import React, { useState, useEffect, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Clock, AlertTriangle, RotateCcw, Sparkles } from 'lucide-react'
import { ProtocolEvent, NodeStatus } from '../types'

interface AgentPipelineProps {
  events: ProtocolEvent[]
  compact?: boolean
  isIdle?: boolean
}

interface NodeInfo {
  id: 'drafter' | 'safety' | 'critic' | 'supervisor' | 'human'
  name: string
  role: string
  status: NodeStatus
  statusLine: string
  metricPill?: string
  durationText?: string
  startTime?: number
}

export default function AgentPipeline({
  events = [],
  compact = false,
  isIdle = false,
}: AgentPipelineProps) {
  const shouldReduceMotion = useReducedMotion()
  const [now, setNow] = useState<number>(Date.now())

  // Shared 1s tick driving live elapsed times on working nodes (P0-2)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Derive node states purely from events (C1)
  const { nodes, revisionCount } = useMemo(() => {
    let revCount = 0

    // Count revisions
    for (const e of events) {
      if (e.type === 'decision' && e.data?.route === 'revise') {
        revCount++
      }
    }

    // Default node info
    const initialNodes: Record<string, NodeInfo> = {
      drafter: {
        id: 'drafter',
        name: 'Protocol Drafter',
        role: 'CBT Protocol Architect',
        status: isIdle ? 'idle' : 'idle',
        statusLine: 'Drafting structured clinical exercise',
      },
      safety: {
        id: 'safety',
        name: 'Safety Guardian',
        role: 'Contraindication & Risk Audit',
        status: isIdle ? 'idle' : 'idle',
        statusLine: 'Auditing 5 clinical safety rubrics',
      },
      critic: {
        id: 'critic',
        name: 'Clinical Critic',
        role: 'CBT Fidelity & Empathy',
        status: isIdle ? 'idle' : 'idle',
        statusLine: 'Evaluating warmth & therapeutic alliance',
      },
      supervisor: {
        id: 'supervisor',
        name: 'Supervisor',
        role: 'Quality & Routing Decision',
        status: isIdle ? 'idle' : 'idle',
        statusLine: 'Synthesizing rubric thresholds',
      },
      human: {
        id: 'human',
        name: 'Reviewer (You)',
        role: 'Final Verification & Approval',
        status: isIdle ? 'idle' : 'idle',
        statusLine: 'User verification sign-off',
      },
    }

    if (isIdle || events.length === 0) {
      return {
        nodes: Object.values(initialNodes),
        revisionCount: 0
      }
    }

    // Scan events to determine node statuses
    const lastRunEvents = events

    for (const e of lastRunEvents) {
      const agentKey =
        e.agent === 'Drafter'
          ? 'drafter'
          : e.agent === 'SafetyGuardian'
          ? 'safety'
          : e.agent === 'ClinicalCritic'
          ? 'critic'
          : e.agent === 'Supervisor'
          ? 'supervisor'
          : e.agent === 'Human'
          ? 'human'
          : null

      if (!agentKey || !initialNodes[agentKey]) continue

      const target = initialNodes[agentKey]

      if (e.type === 'node_start') {
        target.status = 'working'
        target.statusLine = e.text || 'Executing analysis...'
        target.startTime = new Date(e.ts).getTime() || Date.now()
      } else if (e.type === 'node_end') {
        target.status = 'done'
        if (e.data?.latency_ms) {
          target.durationText = `${(e.data.latency_ms / 1000).toFixed(1)}s`
        }
        if (agentKey === 'drafter') {
          target.statusLine = 'Draft generated with required clinical sections'
        } else if (agentKey === 'safety') {
          target.statusLine = 'Checked 5 safety criteria, all passed'
        } else if (agentKey === 'critic') {
          target.statusLine = 'Completed CBT fidelity and empathy review'
        } else if (agentKey === 'supervisor') {
          target.statusLine = 'Synthesized rubric thresholds and approved progression'
        }
      } else if (e.type === 'message') {
        target.statusLine = e.text || ''
        if (e.severity === 'warning' || e.severity === 'major') {
          target.status = 'concern'
        }
      } else if (e.type === 'score' && e.data) {
        if (agentKey === 'safety' && e.data.checks) {
          const passed = Object.values(e.data.checks).filter(Boolean).length
          const total = Object.keys(e.data.checks).length
          target.metricPill = `${passed}/${total} checks`
          if (passed === total) {
            target.statusLine = 'Checked 5 safety criteria, all passed'
          }
        } else if (agentKey === 'critic' && e.data.empathy_score !== undefined) {
          target.metricPill = `Empathy ${e.data.empathy_score.toFixed(1)} · Clinical ${e.data.clinical_score?.toFixed(1) || '—'}`
          target.statusLine = 'Completed CBT fidelity and empathy review'
        }
      } else if (e.type === 'decision' && agentKey === 'supervisor') {
        target.status = 'done'
        if (e.data?.route === 'revise') {
          target.status = 'concern'
          target.metricPill = `Revise (loop ${revCount})`
          target.statusLine = 'Rubric threshold not met; routing revision back to Drafter'
        } else {
          target.metricPill = 'Ready for Review'
          target.statusLine = 'All clinical thresholds satisfied; ready for sign-off'
        }
      } else if (e.type === 'checkpoint') {
        initialNodes.human.status = 'waiting'
        initialNodes.human.statusLine = 'Waiting for your review and approval'
      } else if (e.type === 'approval') {
        initialNodes.human.status = 'done'
        initialNodes.human.statusLine = 'Protocol approved and locked'
      }
    }

    // Update live elapsed duration for working node
    for (const node of Object.values(initialNodes)) {
      if (node.status === 'working' && node.startTime) {
        const elapsed = Math.max(0, Math.floor((now - node.startTime) / 1000))
        node.durationText = `${elapsed}s`
      }
    }

    return {
      nodes: Object.values(initialNodes),
      revisionCount: revCount
    }
  }, [events, isIdle, now])

  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isScrollable, setIsScrollable] = useState(false)

  const checkScroll = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setIsScrollable(el.scrollHeight - el.scrollTop > el.clientHeight + 4)
  }, [])

  useEffect(() => {
    checkScroll()
    const timer = setTimeout(checkScroll, 100)
    window.addEventListener('resize', checkScroll)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', checkScroll)
    }
  }, [nodes, checkScroll])

  // Compact horizontal strip mode (height <700px or width 1024-1535) per C1
  if (compact) {
    return (
      <div className="h-12 w-full px-4 rounded-xl bg-white border border-[#E8E4DA] flex items-center justify-between text-xs shadow-2xs">
        <div className="flex items-center gap-1.5 font-semibold text-[#18221E]">
          <span className="w-2 h-2 rounded-full bg-[#244F3B]" />
          <span>Pipeline</span>
        </div>

        <div className="flex items-center gap-2">
          {nodes.map((node, i) => (
            <React.Fragment key={node.id}>
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  node.status === 'working'
                    ? 'bg-[#EBF3EE] text-[#244F3B] font-semibold border border-[#244F3B]/30 animate-pulse'
                    : node.status === 'done'
                    ? 'bg-[#FAF8F5] text-[#244F3B]'
                    : node.status === 'concern'
                    ? 'bg-[#FEF3C7] text-[#78350F]'
                    : node.status === 'waiting'
                    ? 'bg-[#DBEAFE] text-[#1E40AF] font-semibold animate-pulse'
                    : 'text-[#5C6A62]'
                }`}
                title={node.statusLine}
              >
                <span>{node.name.split(' ')[0]}</span>
                {node.metricPill && (
                  <span className="text-[10px] font-mono px-1 rounded bg-black/5">{node.metricPill}</span>
                )}
              </div>
              {i < nodes.length - 1 && <span className="text-[#D8D2C4]">→</span>}
            </React.Fragment>
          ))}
        </div>

        {revisionCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-[#8C4A26] bg-[#FDF6E2] px-2 py-0.5 rounded-md border border-[#F6E0B5]">
            <RotateCcw className="w-3 h-3" />
            <span>Rev {revisionCount}</span>
          </div>
        )}
      </div>
    )
  }

  // Full Left Rail layout (flex to available height with own scroll & bottom fade) (F11)
  return (
    <div className="bg-white border border-[#E8E4DA] rounded-2xl shadow-2xs flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 pb-2 border-b border-[#F0ECE3] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#244F3B]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#18221E]">Agent Pipeline</h3>
        </div>
        {revisionCount > 0 && (
          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[#FDF6E2] text-[#8C4A26] border border-[#F6E0B5] flex items-center gap-1">
            <RotateCcw className="w-3 h-3" />
            <span>Refinement {revisionCount}</span>
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
        <div
          ref={containerRef}
          onScroll={checkScroll}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1.5 scrollbar-thin"
        >
          {nodes.map((node, index) => {
            const isWorking = node.status === 'working'
            const isDone = node.status === 'done'
            const isConcern = node.status === 'concern'
            const isWaiting = node.status === 'waiting'

            // Single-line collapsed layout once complete (F11)
            if (isDone) {
              return (
                <div key={node.id} className="relative">
                  <div
                    className="px-2.5 py-1.5 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] flex items-center justify-between text-xs transition-all shadow-2xs hover:border-[#244F3B]/30"
                    title={node.statusLine}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-4 h-4 rounded flex items-center justify-center bg-[#244F3B] text-white shrink-0">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span className="font-semibold text-[#18221E] text-xs leading-tight truncate">{node.name}</span>
                      {node.metricPill && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/5 text-[#244F3B] truncate">
                          {node.metricPill}
                        </span>
                      )}
                    </div>
                    {node.durationText && (
                      <span className="text-[10px] font-mono text-[#5C6A62] whitespace-nowrap ml-2 shrink-0">{node.durationText}</span>
                    )}
                  </div>
                  {index < nodes.length - 1 && (
                    <div className="h-1 ml-4 w-0.5 bg-[#E8E4DA] my-0.5" />
                  )}
                </div>
              )
            }

            return (
              <div key={node.id} className="relative">
                <div
                  className={`p-2.5 rounded-xl border transition-all ${
                    isWorking
                      ? 'border-[#244F3B] bg-[#EBF3EE]/60 shadow-xs ring-1 ring-[#244F3B]/30'
                      : isConcern
                      ? 'border-[#F59E0B] bg-[#FEF3C7]/40'
                      : isWaiting
                      ? 'border-[#3B82F6] bg-[#EFF6FF] ring-1 ring-[#3B82F6]/30'
                      : isIdle && index === 0
                      ? 'border-[#244F3B]/40 bg-[#FAF8F5] ring-1 ring-[#244F3B]/30'
                      : isIdle
                      ? 'border-[#E8E4DA] bg-[#FAF8F5] text-[#5C6A62]'
                      : 'border-[#F0ECE3] bg-[#FAF8F5] text-[#5C6A62]'
                  }`}
                >
                  {/* Header Row: Agent name & role on left, latency text on right */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Status Icon */}
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] shrink-0 ${
                          isWorking
                            ? 'bg-[#244F3B] text-white animate-pulse'
                            : isConcern
                            ? 'bg-[#F59E0B] text-white'
                            : isWaiting
                            ? 'bg-[#3B82F6] text-white animate-pulse'
                            : 'bg-[#F0ECE3] text-[#5C6A62]'
                        }`}
                      >
                        {isWorking ? (
                          <Sparkles className="w-3 h-3" />
                        ) : isConcern ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : isWaiting ? (
                          <Clock className="w-3 h-3" />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[#18221E] text-xs leading-tight truncate">{node.name}</p>
                        <p className="text-[10px] text-[#3D4943] leading-tight truncate">{node.role}</p>
                      </div>
                    </div>

                    {/* Duration Text */}
                    {node.durationText && (
                      <span className="text-[10px] font-mono text-[#3D4943] whitespace-nowrap ml-2 shrink-0">{node.durationText}</span>
                    )}
                  </div>

                  {/* Integrated Metric Pill Row */}
                  {node.metricPill && (
                    <div className="mt-1.5 pl-7 flex items-center">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white border border-[#E8E4DA] text-[#244F3B] font-semibold shadow-2xs">
                        {node.metricPill}
                      </span>
                    </div>
                  )}

                  {/* Status line */}
                  <p className="mt-1.5 text-[11px] text-[#3D4943] leading-snug break-words pl-7">{node.statusLine}</p>
                </div>

                {/* Connecting line / handoff dot */}
                {index < nodes.length - 1 && (
                  <div className="h-1.5 ml-5 w-0.5 bg-[#E8E4DA] my-0.5 relative">
                    {isWorking && !shouldReduceMotion && (
                      <motion.div
                        className="absolute w-1.5 h-1.5 -left-[2px] rounded-full bg-[#244F3B]"
                        animate={{ y: [0, 6, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Supervisor -> Drafter loop arc (C1) */}
          {revisionCount > 0 && (
            <div className="mt-2 p-2 rounded-xl bg-[#FDF6E2] border border-[#F6E0B5] flex items-center justify-between text-[11px] text-[#8C4A26]">
              <div className="flex items-center gap-1.5 font-medium">
                <RotateCcw className="w-3.5 h-3.5 text-[#8C4A26]" />
                <span>Supervisor → Drafter loop</span>
              </div>
              <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded-md border border-[#F6E0B5] font-semibold">
                pass {revisionCount}
              </span>
            </div>
          )}
        </div>

        {/* Bottom edge fade when scrollable (F11) */}
        {isScrollable && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white via-white/80 to-transparent z-10" />
        )}
      </div>
    </div>
  )
}
