import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Clock, History, Filter } from 'lucide-react'
import { AGENTS, normalizeAgentId } from '../agents'

export interface LogEntry {
  id: string
  agent: string
  action: string
  timestamp: string
  reasoning?: string
  priority?: 'info' | 'warning' | 'critical'
}

interface ActivityLogSheetProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  entries: LogEntry[]
  revisedCount?: number
}

export default function ActivityLogSheet({
  isOpen,
  onOpenChange,
  entries,
  revisedCount = 0,
}: ActivityLogSheetProps) {
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all')

  // Sorted newest first
  const sortedEntries = [...entries].reverse()

  const filteredEntries =
    selectedAgentFilter === 'all'
      ? sortedEntries
      : sortedEntries.filter((e) => normalizeAgentId(e.agent) === selectedAgentFilter)

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 transition-opacity animate-in fade-in duration-200" />
        <Dialog.Content
          className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-[#FAF8F5] border-l border-[#E8E4DA] shadow-2xl z-50 flex flex-col focus:outline-none animate-in slide-in-from-right duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]"
          aria-describedby="activity-log-description"
        >
          {/* Header */}
          <div className="p-5 border-b border-[#E8E4DA] bg-white flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Dialog.Title className="text-base font-serif font-bold text-[#18221E]">
                  Multi-Agent Activity Log
                </Dialog.Title>
                {revisedCount > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#EBF3EE] text-[#244F3B] border border-[#CDE0D4]">
                    Revised by AI {revisedCount}×
                  </span>
                )}
              </div>
              <p id="activity-log-description" className="text-xs text-[#55635C] mt-0.5">
                {entries.length} total events · Chronological agent execution trace
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7E8F87] hover:text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
                aria-label="Close activity log sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Filter Bar */}
          <div className="px-5 py-2.5 bg-white/70 border-b border-[#E8E4DA] flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
            <Filter className="w-3.5 h-3.5 text-[#7E8F87] mr-1 shrink-0" />
            {['all', 'drafter', 'safety_guardian', 'clinical_critic', 'supervisor'].map((filterKey) => (
              <button
                key={filterKey}
                type="button"
                onClick={() => setSelectedAgentFilter(filterKey)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                  selectedAgentFilter === filterKey
                    ? 'bg-[#244F3B] text-white shadow-2xs'
                    : 'bg-white text-[#55635C] border border-[#E8E4DA] hover:bg-[#F5F2EC]'
                }`}
              >
                {filterKey === 'all'
                  ? 'All Agents'
                  : AGENTS[filterKey]?.label || filterKey}
              </button>
            ))}
          </div>

          {/* Single Scrollable Content Container inside Sheet */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Agent activity trace events"
            className="flex-1 overflow-y-auto p-5 space-y-3 overscroll-contain focus:outline-none scrollbar-thin"
          >
            {filteredEntries.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#7E8F87]">
                <History className="w-8 h-8 mx-auto text-[#7E8F87] mb-2 opacity-50" />
                No events recorded for this view.
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const agent = AGENTS[normalizeAgentId(entry.agent)] || AGENTS.drafter
                const AgentIcon = agent.icon

                // Clean prefix if any remained
                let cleanAction = entry.action || ''
                for (const p of ['IMPROVEMENT NEEDED:', 'SAFETY ISSUE:', 'CRITICAL:']) {
                  if (cleanAction.toUpperCase().startsWith(p)) {
                    cleanAction = cleanAction.slice(p.length).trim()
                  }
                }

                return (
                  <div
                    key={entry.id}
                    className="p-3.5 rounded-xl border border-[#E8E4DA] bg-white transition-all shadow-2xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-[#FAF8F5] border border-[#E8E4DA] flex items-center justify-center text-[#244F3B]">
                          <AgentIcon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-[#18221E]">
                          {agent.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-[#7E8F87] font-mono">
                        <Clock className="w-3 h-3" />
                        <span>
                          {entry.timestamp
                            ? new Date(entry.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : 'Just now'}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-[#2C3B34] leading-relaxed">
                      {cleanAction}
                    </p>

                    {entry.reasoning && (
                      <p className="text-[11px] text-[#7E8F87] bg-[#FAF8F5] p-2 rounded-lg border border-[#F0ECE3]">
                        {entry.reasoning}
                      </p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
