import * as Dialog from '@radix-ui/react-dialog'
import { X, EyeOff, ShieldCheck } from 'lucide-react'
import { ReviewerSuggestion } from '../types'
import { AGENTS } from '../agents'

interface SuggestionsSheetProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  suggestions: ReviewerSuggestion[]
  onToggleAddressed: (id: string) => void
  onDismiss: (id: string) => void
}

export default function SuggestionsSheet({
  isOpen,
  onOpenChange,
  suggestions,
  onToggleAddressed,
  onDismiss,
}: SuggestionsSheetProps) {
  const visibleSuggestions = suggestions.filter((s) => !s.isDismissed)
  const addressedCount = visibleSuggestions.filter((s) => s.isAddressed).length

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 transition-opacity animate-in fade-in duration-200" />
        <Dialog.Content
          className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-[#FAF8F5] border-l border-[#E8E4DA] shadow-2xl z-50 flex flex-col focus:outline-none animate-in slide-in-from-right duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]"
          aria-describedby="suggestions-description"
        >
          {/* Header */}
          <div className="p-5 border-b border-[#E8E4DA] bg-white flex items-center justify-between shrink-0">
            <div>
              <Dialog.Title className="text-base font-serif font-bold text-[#18221E]">
                Reviewer Suggestions
              </Dialog.Title>
              <p id="suggestions-description" className="text-xs text-[#55635C] mt-0.5">
                {addressedCount} of {visibleSuggestions.length} addressed · Refine protocol quality
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7E8F87] hover:text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
                aria-label="Close suggestions sheet"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Single Scrollable Content Container inside Sheet */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Reviewer suggestions list"
            className="flex-1 overflow-y-auto p-5 space-y-3.5 overscroll-contain focus:outline-none scrollbar-thin"
          >
            {visibleSuggestions.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#7E8F87]">
                <ShieldCheck className="w-8 h-8 mx-auto text-[#244F3B] mb-2 opacity-60" />
                No suggestions pending. All reviewer items addressed or dismissed.
              </div>
            ) : (
              visibleSuggestions.map((sug) => {
                const agent = (sug.agentId && AGENTS[sug.agentId]) || AGENTS.clinical_critic
                const AgentIcon = agent.icon

                const severityStyle =
                  sug.severity === 'critical'
                    ? 'bg-[#FDF2F2] text-[#9B2C2C] border-[#F5C6C6]'
                    : sug.severity === 'warning'
                    ? 'bg-[#FEF9EE] text-[#8C5921] border-[#F7E1B5]'
                    : 'bg-[#F4F6F4] text-[#416250] border-[#D6E2DB]'

                return (
                  <div
                    key={sug.id}
                    className={`p-4 rounded-xl border bg-white transition-all shadow-2xs ${
                      sug.isAddressed
                        ? 'opacity-65 border-[#E2DED4] bg-[#F7F5F0]'
                        : 'border-[#E8E4DA] hover:border-[#D1CBBF]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-[#FAF8F5] border border-[#E8E4DA] flex items-center justify-center text-[#244F3B]">
                          <AgentIcon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-[#18221E]">
                          {agent.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border capitalize ${severityStyle}`}
                        >
                          {sug.severity}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDismiss(sug.id)}
                          className="p-1 rounded text-[#8C9B93] hover:text-[#55635C] hover:bg-[#F0ECE3] transition-colors"
                          title="Dismiss suggestion"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className={`text-xs leading-relaxed text-[#2C3B34] ${sug.isAddressed ? 'line-through text-[#7E8F87]' : ''}`}>
                      {sug.message}
                    </p>

                    <div className="mt-3 pt-2.5 border-t border-[#F0ECE3] flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[11px] text-[#55635C] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={Boolean(sug.isAddressed)}
                          onChange={() => onToggleAddressed(sug.id)}
                          className="w-3.5 h-3.5 rounded border-[#C8C2B3] text-[#244F3B] focus:ring-1 focus:ring-[#244F3B]"
                        />
                        <span>{sug.isAddressed ? 'Addressed' : 'Mark as addressed'}</span>
                      </label>

                      {sug.createdAt && (
                        <span className="text-[10px] text-[#8C9B93]">
                          {new Date(sug.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
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
