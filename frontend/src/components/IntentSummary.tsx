import * as Popover from '@radix-ui/react-popover'
import { motion } from 'framer-motion'
import { Bookmark, PlusCircle, Maximize2, X, Info } from 'lucide-react'
import { Phase } from '../types'

interface IntentSummaryProps {
  intent: string
  draftVersion?: number
  maxIterations?: number
  phase: Phase
  onNewProtocol: () => void
}

export default function IntentSummary({
  intent,
  draftVersion = 1,
  maxIterations = 5,
  phase,
  onNewProtocol,
}: IntentSummaryProps) {
  const getStatusLabel = () => {
    switch (phase) {
      case 'generating':
        return 'Drafting & Evaluating'
      case 'review':
        return 'Awaiting Clinician Review'
      case 'editing':
        return 'Clinician Modifying Draft'
      case 'approving':
        return 'Finalizing Protocol'
      case 'approved':
        return 'Approved & Ready'
      default:
        return 'Active Session'
    }
  }

  return (
    <motion.div
      layoutId="intent"
      className="bg-white border border-[#E8E4DA] rounded-xl p-3 sm:p-3.5 shadow-2xs space-y-2.5 shrink-0"
    >
      {/* Top row: Status Chip, Draft version vN, New Protocol */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
              phase === 'approved'
                ? 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]'
                : phase === 'review' || phase === 'editing'
                ? 'bg-[#FBF5EB] text-[#8C5921] border-[#EEDDC3]'
                : 'bg-[#FAF8F5] text-[#55635C] border-[#E8E4DA]'
            }`}
          >
            {getStatusLabel()}
          </span>

          {/* Section 4: Draft v{n} only, never Round X of 5; max iterations in tooltip */}
          <span
            className="text-[11px] font-semibold text-[#18221E] bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#E8E4DA] cursor-help inline-flex items-center gap-1"
            title={`Draft version ${draftVersion}. Maximum review cycles: ${maxIterations}`}
          >
            <span>Draft v{draftVersion}</span>
            <Info className="w-2.5 h-2.5 text-[#88978F]" />
          </span>
        </div>

        <button
          type="button"
          onClick={onNewProtocol}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-[#244F3B] transition-colors shadow-2xs cursor-pointer"
        >
          <PlusCircle className="w-3 h-3" />
          <span>New</span>
        </button>
      </div>

      {/* Main Intent Text strip: line-clamp-3 with Popover for full text (Section 1) */}
      <div className="pt-2 border-t border-[#F0ECE3]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Bookmark className="w-3.5 h-3.5 text-[#244F3B] shrink-0 mt-0.5" />
            <p className="text-xs text-[#18221E] font-medium line-clamp-3 leading-relaxed">
              "{intent}"
            </p>
          </div>

          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="shrink-0 p-1 text-[#7E8F87] hover:text-[#244F3B] hover:bg-[#FAF8F5] rounded transition-colors cursor-pointer"
                title="View full prompt intent"
                aria-label="View full clinical intent prompt"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="right"
                align="start"
                sideOffset={8}
                className="z-50 w-80 sm:w-96 max-h-72 overflow-y-auto rounded-xl border border-[#E8E4DA] bg-white p-3.5 shadow-xl text-xs space-y-2 animate-in fade-in-50"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-[#F0ECE3]">
                  <span className="font-semibold text-[#18221E]">Clinical Intent Prompt</span>
                  <Popover.Close
                    className="p-1 rounded text-[#88978F] hover:text-[#18221E]"
                    aria-label="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Popover.Close>
                </div>
                <p className="text-xs text-[#333E37] leading-relaxed whitespace-pre-wrap">
                  {intent}
                </p>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    </motion.div>
  )
}
