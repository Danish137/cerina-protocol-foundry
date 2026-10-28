import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Check,
  CheckCircle2,
  Edit3,
  X,
  ShieldCheck,
  Download,
  Copy,
  PlusCircle,
  Loader2,
  AlertTriangle,
  Clock,
  GitCompare,
  RotateCcw,
} from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { Phase, ValidationStatus } from '../types'
import { formatLocalDateTime } from '../utils/dateFormatter'

interface ActionPanelProps {
  phase: Phase
  validationStatus: ValidationStatus
  hasEdits?: boolean
  wordsAdded?: number
  wordsRemoved?: number
  approvalTime?: string
  lastValidatedTime?: string
  majorConcerns?: { id: string; text: string }[]
  isRevisionRequested?: boolean
  onApprove: () => void
  onStartEditing: () => void
  onSaveEditsAndApprove: () => void
  onRevalidateOnly: () => void
  onDiscardEdits: () => void
  onExportPdf: (includeDetails?: boolean) => void
  onCopyMarkdown: () => void
  onNewProtocol: () => void
  onRequestRevision?: (instruction?: string, concernIds?: string[]) => void
  onOpenDiffPopover?: () => void
  onOpenReviewDetails?: () => void
}

export default function ActionPanel({
  phase,
  validationStatus,
  hasEdits = false,
  wordsAdded = 0,
  wordsRemoved = 0,
  approvalTime,
  lastValidatedTime,
  majorConcerns = [],
  isRevisionRequested = false,
  onApprove,
  onStartEditing,
  onSaveEditsAndApprove,
  onRevalidateOnly,
  onDiscardEdits,
  onExportPdf,
  onCopyMarkdown,
  onNewProtocol,
  onRequestRevision,
  onOpenDiffPopover,
  onOpenReviewDetails,
}: ActionPanelProps) {
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'preparing' | 'downloaded'>('idle')
  const [hasExported, setHasExported] = useState(false)
  const [includeDetailsInPdf, setIncludeDetailsInPdf] = useState(false)
  const [copiedMd, setCopiedMd] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [selectedConcernIds, setSelectedConcernIds] = useState<string[]>([])
  const [isRevisionPopoverOpen, setIsRevisionPopoverOpen] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  const handleToggleConcern = (id: string, text: string) => {
    setSelectedConcernIds((prev) => {
      const exists = prev.includes(id)
      if (exists) {
        return prev.filter((item) => item !== id)
      } else {
        setCustomInstruction((curr) => (curr ? `${curr}\n- ${text}` : `- ${text}`))
        return [...prev, id]
      }
    })
  }

  const handleSubmitRevision = () => {
    setIsRevisionPopoverOpen(false)
    onRequestRevision?.(customInstruction, selectedConcernIds)
  }

  const handleExportClick = async () => {
    try {
      setExportState('preparing')
      await onExportPdf(includeDetailsInPdf)
      setExportState('downloaded')
      setHasExported(true)
      setTimeout(() => {
        setExportState('idle')
      }, 3000)
    } catch {
      setExportState('idle')
    }
  }

  const handleCopyMdClick = () => {
    onCopyMarkdown()
    setCopiedMd(true)
    setTimeout(() => setCopiedMd(false), 2000)
  }

  // Word change label formatting
  const addWordStr = wordsAdded === 1 ? '+1 word' : `+${wordsAdded} words`
  const remWordStr = wordsRemoved === 1 ? '−1 word' : `−${wordsRemoved} words`
  const wordDiffText =
    wordsAdded > 0 && wordsRemoved > 0
      ? `${addWordStr} · ${remWordStr}`
      : wordsAdded > 0
      ? addWordStr
      : wordsRemoved > 0
      ? remWordStr
      : 'No word changes'

  return (
    <motion.div
      layout={!shouldReduceMotion}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="w-full bg-white border-t border-[#E8E4DA] p-3 sm:p-3.5 shrink-0"
      role="region"
      aria-label="Action Controls"
    >
      {/* =====================================================================
          PHASE: APPROVED (Morphs into in-place Success Card or Collapsed Post-Export)
         ===================================================================== */}
      {phase === 'approved' && hasExported && (
        <div className="p-2 sm:p-2.5 rounded-xl bg-[#EBF3EE] border border-[#C2DBCB] flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-[#244F3B] shrink-0" />
            <div className="truncate">
              <span className="font-semibold text-[#18221E]">PDF Exported</span>
              <span className="text-[11px] text-[#55635C] ml-1.5 hidden sm:inline">Saved to Downloads</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleExportClick}
              disabled={exportState === 'preparing'}
              className="py-1 px-2 rounded-lg bg-white hover:bg-[#F2EFE8] border border-[#C2DBCB] text-[11px] font-semibold text-[#244F3B] transition-colors flex items-center gap-1 cursor-pointer"
              title="Download PDF again"
            >
              {exportState === 'preparing' ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#244F3B]" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              <span>Re-export</span>
            </button>
            <button
              type="button"
              onClick={handleCopyMdClick}
              className="py-1 px-2 rounded-lg bg-white hover:bg-[#F2EFE8] border border-[#C2DBCB] text-[11px] font-semibold text-[#18221E] transition-colors flex items-center gap-1 cursor-pointer"
              title="Copy Markdown"
            >
              {copiedMd ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-[#55635C]" />}
              <span>{copiedMd ? 'Copied' : 'MD'}</span>
            </button>
            <button
              type="button"
              onClick={onNewProtocol}
              className="py-1 px-2 rounded-lg bg-white hover:bg-[#F2EFE8] border border-[#C2DBCB] text-[11px] font-semibold text-[#244F3B] transition-colors flex items-center gap-1 cursor-pointer"
              title="Start a new protocol"
            >
              <PlusCircle className="w-3 h-3" />
              <span>New</span>
            </button>
          </div>
        </div>
      )}

      {phase === 'approved' && !hasExported && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-[#244F3B] shrink-0" />
              <span className="text-xs font-bold text-[#18221E] truncate">
                Approved by you
              </span>
              <span className="text-[10px] text-[#55635C] truncate">
                · {approvalTime ? (approvalTime.includes('T') || approvalTime.includes('-') ? formatLocalDateTime(approvalTime) : approvalTime) : formatLocalDateTime(new Date().toISOString())}
              </span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EBF3EE] text-[#244F3B] border border-[#C2DBCB] shrink-0 font-bold">
              READY
            </span>
          </div>

          {/* Primary: Export PDF */}
          <button
            type="button"
            onClick={handleExportClick}
            disabled={exportState === 'preparing'}
            className="w-full py-2.5 px-4 rounded-xl bg-[#244F3B] hover:bg-[#1B3D2E] active:scale-[0.99] text-white text-xs sm:text-sm font-bold shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] cursor-pointer"
          >
            {exportState === 'preparing' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Preparing Clinical PDF…</span>
              </>
            ) : exportState === 'downloaded' ? (
              <>
                <Check className="w-3.5 h-3.5 stroke-[2.5] text-emerald-300" />
                <span>Downloaded ✓</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Export Clinical PDF</span>
              </>
            )}
          </button>

          {/* Secondary Controls: Checkbox + Copy MD + New */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#F0ECE3] text-xs">
            <label className="flex items-center gap-1.5 text-[11px] text-[#55635C] cursor-pointer">
              <input
                type="checkbox"
                checked={includeDetailsInPdf}
                onChange={(e) => setIncludeDetailsInPdf(e.target.checked)}
                className="rounded text-[#244F3B] focus:ring-[#244F3B] w-3.5 h-3.5"
              />
              <span>Include review details</span>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyMdClick}
                className="py-1 px-2 rounded-md hover:bg-[#F2EFE8] text-[11px] font-medium text-[#18221E] transition-colors flex items-center gap-1 cursor-pointer"
                title="Copy Markdown"
              >
                {copiedMd ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-[#55635C]" />}
                <span>{copiedMd ? 'Copied' : 'MD'}</span>
              </button>

              <button
                type="button"
                onClick={onNewProtocol}
                className="py-1 px-2 rounded-md hover:bg-[#F2EFE8] text-[11px] font-medium text-[#244F3B] transition-colors flex items-center gap-1 cursor-pointer"
                title="Start new protocol"
              >
                <PlusCircle className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PHASE: APPROVING (In-Flight)
         ===================================================================== */}
      {phase === 'approving' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-[#244F3B]" />
            <div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#18221E]">
                Finalizing Protocol…
              </h3>
              <p className="text-[11px] text-[#55635C]">
                Persisting clinical checkpoint and unlocking export.
              </p>
            </div>
          </div>
          <button
            disabled
            type="button"
            className="w-full py-2.5 px-4 rounded-xl bg-[#D8D2C4] text-[#88978F] text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Finalizing…</span>
          </button>
        </div>
      )}

      {/* =====================================================================
          PHASE: GENERATING (AI Drafting in Progress)
         ===================================================================== */}
      {phase === 'generating' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#EBF3EE] text-[#244F3B] flex items-center justify-center shrink-0 border border-[#CDE0D4]">
              <Loader2 className="w-4 h-4 animate-spin text-[#244F3B]" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#18221E]">
                AI Review Team Active
              </h3>
              <p className="text-[11px] text-[#55635C]">
                Drafting protocol & evaluating clinical metrics…
              </p>
            </div>
          </div>

          <button
            disabled
            type="button"
            className="w-full py-2.5 px-4 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] text-[#88978F] text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Clock className="w-3.5 h-3.5 text-[#88978F]" />
            <span>Review controls unlock when ready</span>
          </button>
        </div>
      )}

      {/* =====================================================================
          PHASE: EDITING
         ===================================================================== */}
      {phase === 'editing' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-[#18221E]">
                Editing Draft
              </h3>
              <p className="text-[11px] font-mono text-[#78350F] font-semibold mt-0.5">
                {wordDiffText} · unsaved
              </p>
            </div>

            {onOpenDiffPopover && hasEdits && (
              <button
                type="button"
                onClick={onOpenDiffPopover}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-[#18221E] transition-colors flex items-center gap-1"
              >
                <GitCompare className="w-3 h-3 text-[#244F3B]" />
                <span>Review changes</span>
              </button>
            )}
          </div>

          {/* Honest Validation Banner */}
          <div className="p-2.5 rounded-lg border text-xs">
            {validationStatus === 'checking' ? (
              <div className="flex items-center gap-2 text-[#244F3B]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#244F3B]" />
                <span className="text-[11px]">Re-checking draft with Safety Guardian & Critic…</span>
              </div>
            ) : validationStatus === 'passed' ? (
              <div className="flex items-center gap-2 text-[#244F3B]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />
                <span className="text-[11px]">
                  Checked by Safety Guardian & Clinical Critic · {lastValidatedTime || 'Recent'}
                </span>
              </div>
            ) : validationStatus === 'stale' ? (
              <div className="flex items-center justify-between gap-2 text-[#78350F]">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#B45309] shrink-0" />
                  <span>You've edited since the last safety check.</span>
                </div>
                <button
                  type="button"
                  onClick={onRevalidateOnly}
                  className="text-[11px] font-semibold text-[#244F3B] hover:underline shrink-0"
                >
                  Re-check only
                </button>
              </div>
            ) : validationStatus === 'failed' ? (
              <div className="flex items-center justify-between gap-2 text-[#9B2C2C]">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#9B2C2C] shrink-0" />
                  <span>Quality scores below required threshold.</span>
                </div>
                <button
                  type="button"
                  onClick={onRevalidateOnly}
                  className="text-[11px] font-semibold text-[#244F3B] hover:underline shrink-0"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-[#55635C]">
                <span className="text-[11px]">Draft ready for safety validation or approval.</span>
                <button
                  type="button"
                  onClick={onRevalidateOnly}
                  className="text-[11px] font-semibold text-[#244F3B] hover:underline shrink-0"
                >
                  Re-check only
                </button>
              </div>
            )}
          </div>

          {/* Primary Action Button: "Approve & finalize" vs "Re-check & approve" */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={onSaveEditsAndApprove}
              disabled={validationStatus === 'checking'}
              className="w-full py-2.5 px-4 rounded-xl bg-[#244F3B] hover:bg-[#1B3D2E] active:scale-[0.99] text-white text-xs sm:text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
            >
              {validationStatus === 'checking' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Checking & approving…</span>
                </>
              ) : hasEdits && validationStatus !== 'passed' ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Re-check & approve</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Save edits & approve</span>
                </>
              )}
            </button>

            {/* Discard Control with confirmation popover */}
            <div className="relative">
              {!showDiscardConfirm ? (
                <button
                  type="button"
                  onClick={() => {
                    if (hasEdits) {
                      setShowDiscardConfirm(true)
                    } else {
                      onDiscardEdits()
                    }
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-xs font-semibold text-[#55635C] transition-colors flex items-center justify-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Discard edits</span>
                </button>
              ) : (
                <div className="p-3 bg-[#FFF8F8] border border-[#F5C6C6] rounded-xl text-xs space-y-2 animate-in fade-in">
                  <p className="font-semibold text-[#9B2C2C]">
                    Discard unsaved changes?
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDiscardConfirm(false)
                        onDiscardEdits()
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-[#9B2C2C] text-white text-xs font-semibold hover:bg-[#822424] transition-colors"
                    >
                      Yes, discard
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDiscardConfirm(false)}
                      className="flex-1 py-1.5 rounded-lg bg-white text-[#55635C] border border-[#E8E4DA] text-xs font-semibold hover:bg-[#F5F2EC] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PHASE: REVIEW (Default Review Mode)
         ===================================================================== */}
      {/* =====================================================================
          PHASE: REVIEW (Default Review Mode)
         ===================================================================== */}
      {phase === 'review' && isRevisionRequested && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#EBF3EE] text-[#244F3B] flex items-center justify-center shrink-0 border border-[#CDE0D4]">
              <Loader2 className="w-4 h-4 animate-spin text-[#244F3B]" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#18221E]">
                Revision requested · agents working
              </h3>
              <p className="text-[11px] text-[#55635C]">
                Updating protocol to incorporate requested clinical adjustments…
              </p>
            </div>
          </div>
          <button
            disabled
            type="button"
            className="w-full py-2 px-3 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] text-[#88978F] text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Clock className="w-3.5 h-3.5 text-[#88978F]" />
            <span>Review controls unlock when ready</span>
          </button>
        </div>
      )}

      {phase === 'review' && !isRevisionRequested && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-[#18221E]">
                Your review is needed
              </h3>
              <p className="text-[11px] text-[#55635C]">
                Approving locks this version and unlocks export.
              </p>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#FBF5EB] text-[#8C5921] border border-[#EEDDC3] shrink-0 self-start">
              ACTION REQUIRED
            </span>
          </div>

          <div className="space-y-1.5">
            {/* Primary: Approve & finalize */}
            <button
              type="button"
              onClick={onApprove}
              className="w-full py-2 px-3 rounded-xl bg-[#244F3B] hover:bg-[#1B3D2E] active:scale-[0.99] text-white text-xs sm:text-sm font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Approve & finalize</span>
            </button>

              {/* Secondary 3-column subgrid: AI Details, Edit draft, Revise */}
              <div className="grid grid-cols-3 gap-1.5">
                {onOpenReviewDetails && (
                  <button
                    type="button"
                    onClick={onOpenReviewDetails}
                    className="py-1.5 px-1.5 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-[11px] font-medium text-[#244F3B] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    title="View AI Review Details & Rubrics"
                  >
                    <ShieldCheck className="w-3 h-3 text-[#244F3B] shrink-0" />
                    <span className="truncate">AI Details</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onStartEditing}
                  className="py-1.5 px-1.5 rounded-lg bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-[11px] font-medium text-[#55635C] hover:text-[#18221E] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  title="Edit draft directly"
                >
                  <Edit3 className="w-3 h-3 text-[#7E8F87] shrink-0" />
                  <span className="truncate">Edit draft</span>
                </button>

                {/* Request revision popover (C7) */}
                <Popover.Root open={isRevisionPopoverOpen} onOpenChange={setIsRevisionPopoverOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="py-1.5 px-1.5 rounded-lg bg-white hover:bg-[#FDF6E2] border border-[#F6E0B5] text-[11px] font-medium text-[#8C4A26] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      title="Request AI revision"
                    >
                      <RotateCcw className="w-3 h-3 text-[#8C4A26] shrink-0" />
                      <span className="truncate">Revise</span>
                    </button>
                  </Popover.Trigger>

                  <Popover.Portal>
                    <Popover.Content
                      side="top"
                      align="end"
                      sideOffset={8}
                      className="z-50 w-80 rounded-2xl border border-[#E8E4DA] bg-white p-4 shadow-xl space-y-3 text-xs animate-in fade-in zoom-in-95"
                    >
                      <div>
                        <h4 className="font-semibold text-[#18221E] text-sm">Request Protocol Revision</h4>
                        <p className="text-[11px] text-[#55635C]">Provide steering notes back to the Protocol Drafter</p>
                      </div>

                      {/* Concern chips if present */}
                      {majorConcerns.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] uppercase font-bold text-[#5C6A62]">Open Concerns:</span>
                          <div className="flex flex-wrap gap-1">
                            {majorConcerns.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleToggleConcern(c.id, c.text)}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                  selectedConcernIds.includes(c.id)
                                    ? 'bg-[#8C4A26] text-white border-[#8C4A26]'
                                    : 'bg-[#FDF6E2] text-[#8C4A26] border-[#F6E0B5] hover:bg-[#F9ECC9]'
                                }`}
                              >
                                {c.text.slice(0, 30)}...
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <textarea
                        value={customInstruction}
                        onChange={(e) => setCustomInstruction(e.target.value)}
                        placeholder="e.g. Please simplify the language in Step 2 and add a grounding breath exercise..."
                        className="w-full h-24 p-2.5 rounded-lg border border-[#E8E4DA] bg-[#FAF8F5] text-xs leading-relaxed text-[#18221E] placeholder-[#A0ACA5] resize-none focus:outline-none focus:ring-1 focus:ring-[#244F3B]"
                      />

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#F0ECE3]">
                        <button
                          type="button"
                          onClick={() => setIsRevisionPopoverOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-[#E8E4DA] text-xs font-medium text-[#55635C] hover:bg-[#FAF8F5]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSubmitRevision}
                          disabled={!customInstruction.trim() && selectedConcernIds.length === 0}
                          className="px-3.5 py-1.5 rounded-lg bg-[#244F3B] text-white text-xs font-semibold hover:bg-[#1B3D2E] disabled:opacity-50 transition-colors shadow-2xs"
                        >
                          Submit Revision
                        </button>
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>
            </div>
          </div>
      )}
    </motion.div>
  )
}
