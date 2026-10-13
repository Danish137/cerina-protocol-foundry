import { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X,
  History,
  Cpu,
  ChevronDown,
  ChevronRight,
  Filter
} from 'lucide-react'
import { ProtocolEvent } from '../types'

interface TimelineSheetProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  events: ProtocolEvent[]
  underTheHood: boolean
  onToggleUnderTheHood: () => void
}

interface RunGroup {
  runId: string
  title: string
  kind: string
  events: ProtocolEvent[]
  startTime?: string
  durationText?: string
}

export default function TimelineSheet({
  isOpen,
  onOpenChange,
  events = [],
  underTheHood,
  onToggleUnderTheHood
}: TimelineSheetProps) {
  const [filterType, setFilterType] = useState<'all' | 'concerns' | 'decisions'>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<'timeline' | 'blackboard'>('timeline')

  // Group events by run_id (C4)
  const runGroups: RunGroup[] = useMemo(() => {
    const groupsMap = new Map<string, ProtocolEvent[]>()
    for (const e of events) {
      const rid = e.run_id || 'initial'
      if (!groupsMap.has(rid)) {
        groupsMap.set(rid, [])
      }
      groupsMap.get(rid)!.push(e)
    }

    const result: RunGroup[] = []
    let runIndex = 1

    for (const [rid, rEvents] of groupsMap.entries()) {
      const sorted = [...rEvents].sort((a, b) => a.seq - b.seq)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]

      let kindLabel = 'Drafting & reviewing'
      if (first.run_kind === 'revision') kindLabel = 'Refinement & review'
      else if (first.run_kind === 'human_revision') kindLabel = 'Revised after your request'
      else if (first.run_kind === 'recheck') kindLabel = 'Re-check after edits'
      else if (first.run_kind === 'approval') kindLabel = 'Approval'

      // Calculate run duration
      let durationText = ''
      try {
        const startMs = new Date(first.ts).getTime()
        const endMs = new Date(last.ts).getTime()
        if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
          const diff = ((endMs - startMs) / 1000).toFixed(1)
          durationText = `${diff}s`
        }
      } catch (_) {}

      result.push({
        runId: rid,
        title: `${kindLabel}${durationText ? ` · ${durationText}` : ''}`,
        kind: first.run_kind,
        events: sorted,
        startTime: first.ts,
        durationText
      })
      runIndex++
    }

    return result
  }, [events])

  // Track expanded runs (newest run expanded by default)
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({})

  // Initialize newest run expanded
  useMemo(() => {
    if (runGroups.length > 0) {
      const latest = runGroups[runGroups.length - 1].runId
      setExpandedRuns((prev) => ({ ...prev, [latest]: true }))
    }
  }, [runGroups.length])

  const toggleRunExpanded = (rid: string) => {
    setExpandedRuns((prev) => ({ ...prev, [rid]: !prev[rid] }))
  }

  // Filter events within run
  const filterRunEvents = (rEvents: ProtocolEvent[]) => {
    return rEvents.filter((e) => {
      if (agentFilter !== 'all' && e.agent !== agentFilter) return false
      if (filterType === 'concerns') {
        return e.severity === 'warning' || e.severity === 'major' || e.severity === 'critical'
      }
      if (filterType === 'decisions') {
        return e.type === 'decision' || e.type === 'checkpoint' || e.type === 'approval'
      }
      return true
    })
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 animate-in fade-in" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white border-l border-[#E8E4DA] z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-250 select-none">
          {/* Sheet Header */}
          <div className="p-4 border-b border-[#F0ECE3] flex items-center justify-between shrink-0 bg-[#FAF8F5]">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-[#244F3B]" />
              <div>
                <Dialog.Title className="text-base font-serif font-bold text-[#18221E]">
                  Protocol Execution Timeline
                </Dialog.Title>
                <p className="text-xs text-[#7C8B82]">{events.length} system events recorded</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Under The Hood Toggle (C4) */}
              <button
                type="button"
                onClick={onToggleUnderTheHood}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer ${
                  underTheHood
                    ? 'bg-[#244F3B] text-white border-[#244F3B]'
                    : 'bg-white text-[#55635C] border-[#E8E4DA] hover:bg-[#F5F2EC]'
                }`}
                title="Toggle technical telemetry (tokens, latency, rubrics)"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px]">Under the Hood</span>
              </button>

              <Dialog.Close asChild>
                <button
                  type="button"
                  id="close-timeline-btn"
                  aria-label="Close timeline"
                  className="p-1 rounded-lg text-[#7C8B82] hover:text-[#18221E] hover:bg-[#E8E4DA] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Under The Hood Tabs (Timeline vs Blackboard) */}
          {underTheHood && (
            <div className="px-4 py-2 bg-[#F5EDE0] border-b border-[#E8DFC8] flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('timeline')}
                className={`px-3 py-1 rounded-md font-semibold transition-all ${
                  activeTab === 'timeline' ? 'bg-[#244F3B] text-white' : 'text-[#8C4A26] hover:bg-white/50'
                }`}
              >
                Telemetry Events
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('blackboard')}
                className={`px-3 py-1 rounded-md font-semibold transition-all ${
                  activeTab === 'blackboard' ? 'bg-[#244F3B] text-white' : 'text-[#8C4A26] hover:bg-white/50'
                }`}
              >
                Blackboard State
              </button>
            </div>
          )}

          {/* Filters Bar (Hidden on Blackboard Tab per P1-4) */}
          {activeTab === 'timeline' && (
            <div className="p-3 border-b border-[#F0ECE3] flex items-center justify-between gap-3 text-xs bg-white shrink-0">
              {/* Segmented Filter */}
              <div className="inline-flex rounded-lg border border-[#E8E4DA] p-0.5 bg-[#FAF8F5]">
                {(['all', 'concerns', 'decisions'] as const).map((ft) => (
                  <button
                    key={ft}
                    type="button"
                    onClick={() => setFilterType(ft)}
                    className={`px-2.5 py-1 rounded-md font-medium capitalize transition-all ${
                      filterType === ft
                        ? 'bg-white shadow-xs text-[#244F3B] font-semibold'
                        : 'text-[#7C8B82] hover:text-[#18221E]'
                    }`}
                  >
                    {ft}
                  </button>
                ))}
              </div>

              {/* Agent Select Filter */}
              <div className="flex items-center gap-1.5 text-xs text-[#55635C]">
                <Filter className="w-3.5 h-3.5 text-[#A0ACA5]" />
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="px-2 py-1 rounded-md border border-[#E8E4DA] bg-[#FAF8F5] text-xs font-medium focus:outline-none"
                >
                  <option value="all">All Agents</option>
                  <option value="Drafter">Protocol Drafter</option>
                  <option value="SafetyGuardian">Safety Guardian</option>
                  <option value="ClinicalCritic">Clinical Critic</option>
                  <option value="Supervisor">Clinical Supervisor</option>
                  <option value="Human">Clinical Reviewer</option>
                </select>
              </div>
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'blackboard' && underTheHood ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#F0ECE3] pb-2">
                    <span className="font-bold text-xs uppercase tracking-wider text-[#244F3B]">Blackboard Orchestrator State</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-[#E8E4DA] text-[#55635C]">Live Snapshot</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2 rounded bg-white border border-[#F0ECE3]">
                      <span className="text-[#7C8B82] block text-[10px]">Draft Version:</span>
                      <span className="font-bold text-[#18221E]">v{events.slice(-1)[0]?.draft_version || 1}</span>
                    </div>
                    <div className="p-2 rounded bg-white border border-[#F0ECE3]">
                      <span className="text-[#7C8B82] block text-[10px]">Run Kind:</span>
                      <span className="font-bold text-[#18221E]">{events.slice(-1)[0]?.run_kind || 'initial'}</span>
                    </div>
                    <div className="p-2 rounded bg-white border border-[#F0ECE3]">
                      <span className="text-[#7C8B82] block text-[10px]">Halted / Review:</span>
                      <span className="font-bold text-[#18221E]">
                        {events.some((e) => e.type === 'checkpoint') ? 'True (Awaiting Review)' : 'False'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-white border border-[#F0ECE3]">
                      <span className="text-[#7C8B82] block text-[10px]">Total Events:</span>
                      <span className="font-bold text-[#18221E]">{events.length}</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-white border border-[#F0ECE3] space-y-1 text-xs font-mono">
                    <span className="text-[#7C8B82] block text-[10px] font-bold">Latest Score Verdicts:</span>
                    {events.filter((e) => e.type === 'score').slice(-3).map((s, idx) => (
                      <div key={idx} className="text-[11px] text-[#18221E] flex items-center justify-between">
                        <span>[{s.agent}]:</span>
                        <span className="text-[#244F3B] font-semibold">{s.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] font-mono text-xs space-y-2">
                  <p className="font-bold text-[#244F3B] text-[11px]">Latest Event Data Payload</p>
                  <pre className="text-[10.5px] text-[#18221E] overflow-x-auto p-3 rounded bg-white border border-[#F0ECE3]">
                    {JSON.stringify(
                      events.filter((e) => e.data && Object.keys(e.data).length > 0).slice(-1)[0]?.data || {},
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {runGroups.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#A0ACA5]">
                    <p>No events recorded yet.</p>
                  </div>
                ) : (
                  runGroups.map((group, groupIdx) => {
                    const isLatest = groupIdx === runGroups.length - 1
                    const isExpanded = expandedRuns[group.runId] !== undefined ? expandedRuns[group.runId] : isLatest
                    const filteredEvents = filterRunEvents(group.events)
                    const startMs = new Date(group.startTime || '').getTime()

                    return (
                      <div
                        key={group.runId}
                        className="rounded-xl border border-[#E8E4DA] overflow-hidden bg-white shadow-2xs"
                      >
                        {/* Run Header with 5-dot mini pipeline (C4) */}
                        <button
                          type="button"
                          onClick={() => toggleRunExpanded(group.runId)}
                          className="w-full p-3 bg-[#FAF8F5] hover:bg-[#F5F2EC] flex items-center justify-between text-xs font-semibold text-[#18221E] transition-colors border-b border-[#F0ECE3]"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[#7C8B82]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#7C8B82]" />
                            )}
                            <span>{group.title}</span>
                          </div>

                          {/* Mini 5-dot pipeline */}
                          <div className="flex items-center gap-1">
                            {['Drafter', 'SafetyGuardian', 'ClinicalCritic', 'Supervisor', 'Human'].map((ag) => {
                              const hasNode = group.events.some((e) => e.agent === ag)
                              return (
                                <span
                                  key={ag}
                                  className={`w-2 h-2 rounded-full ${hasNode ? 'bg-[#244F3B]' : 'bg-[#E8E4DA]'}`}
                                  title={ag}
                                />
                              )
                            })}
                          </div>
                        </button>

                        {/* Run Events */}
                        {isExpanded && (
                          <div className="p-3 space-y-2">
                            {filteredEvents.length === 0 ? (
                              <p className="text-xs text-[#A0ACA5] italic text-center py-2">
                                No matching events under current filter.
                              </p>
                            ) : (
                              filteredEvents.map((evt) => {
                                const evtMs = new Date(evt.ts).getTime()
                                const offsetSec = !isNaN(startMs) && !isNaN(evtMs) && evtMs >= startMs
                                  ? `+${((evtMs - startMs) / 1000).toFixed(1)}s`
                                  : '+0.0s'
                                const cleanText = underTheHood ? evt.text : evt.text.replace(/\s*\((llm|rule|unavailable)\)/gi, '')

                                return (
                                  <div
                                    key={`${evt.seq}_${evt.ts}`}
                                    className="p-2.5 rounded-lg border border-[#F0ECE3] bg-[#FAF8F5] text-xs space-y-1 hover:border-[#D5C9B5] transition-colors"
                                  >
                                    <div className="flex items-center justify-between text-[11px]">
                                      <div className="flex items-center gap-1.5 font-semibold text-[#18221E]">
                                        <span className="font-mono text-[#7C8B82] text-[10px]">#{evt.seq}</span>
                                        <span>{evt.agent === 'SafetyGuardian' ? 'Safety Guardian' : evt.agent === 'ClinicalCritic' ? 'Clinical Critic' : evt.agent}</span>
                                        {evt.to_agent && (
                                          <span className="text-[#7C8B82]">→ {evt.to_agent === 'SafetyGuardian' ? 'Safety Guardian' : evt.to_agent === 'ClinicalCritic' ? 'Clinical Critic' : evt.to_agent}</span>
                                        )}
                                        <span className="font-normal text-[10px] text-[#A0ACA5]">
                                          ({evt.type})
                                        </span>
                                      </div>

                                      {/* Offset time and absolute time on hover (C4) */}
                                      <span
                                        className="font-mono text-[10px] text-[#7C8B82] cursor-help"
                                        title={new Date(evt.ts).toLocaleString()}
                                      >
                                        {offsetSec}
                                      </span>
                                    </div>

                                    <p className="text-[#55635C] leading-relaxed text-[11px]">{cleanText}</p>

                                    {/* Under the hood technical details (C4) */}
                                    {underTheHood && evt.data && Object.keys(evt.data).length > 0 && (
                                      <div className="pt-1 mt-1 border-t border-[#F0ECE3] font-mono text-[10px] text-[#7C8B82] space-y-0.5">
                                        {evt.data.latency_ms && (
                                          <div>latency: {evt.data.latency_ms}ms</div>
                                        )}
                                        {evt.data.score_source && (
                                          <div>score_source: {evt.data.score_source}</div>
                                        )}
                                        {evt.data.tokens && <div>tokens: {evt.data.tokens}</div>}
                                        {evt.data.route && <div>route: {evt.data.route}</div>}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
