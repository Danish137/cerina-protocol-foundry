import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Check,
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
      aria-label="Clinician Action Controls"
    >
      {/* =====================================================================
          PHASE: APPROVED (Morphs into in-place Success Card)
         ===================================================================== */}
      {phase === 'approved' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[#EBF3EE] text-[#244F3B] flex items-center justify-center shrink-0 mt-0.5 border border-[#CDE0D4]">
              <svg className="w-5 h-5 text-[#244F3B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <motion.path
                  d="M5 13l4 4L19 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={shouldReduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#18221E] font-sans">
                Approved by you on {approvalTime ? (approvalTime.includes('T') || approvalTime.includes('-') ? formatLocalDateTime(approvalTime) : approvalTime) : formatLocalDateTime(new Date().toISOString())}.
              </h3>
              <p className="text-xs text-[#55635C] mt-0.5">
                AI-reviewed; not clinically validated.
              </p>
            </div>
          </div>

          {/* Primary: Export PDF (Largest button in the app) */}
          <button
            type="button"
            onClick={handleExportClick}
            disabled={exportState === 'preparing'}
            className="w-full py-3.5 px-5 rounded-xl bg-[#244F3B] hover:bg-[#1B3D2E] active:scale-[0.99] text-white text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] focus-visible:ring-offset-2"
          >
            {exportState === 'preparing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Preparing Clinical PDF…</span>
              </>
            ) : exportState === 'downloaded' ? (
              <>
                <Check className="w-4 h-4 stroke-[2.5] text-emerald-300" />
                <span>Downloaded ✓</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span className="text-base tracking-wide">Export Clinical PDF</span>
              </>
            )}
          </button>

          {/* Optional review details toggle (D3 - defaults OFF) */}
          <label className="flex items-center gap-2 text-xs text-[#55635C] cursor-pointer px-1">
            <input
              type="checkbox"
              checked={includeDetailsInPdf}
              onChange={(e) => setIncludeDetailsInPdf(e.target.checked)}
              className="rounded text-[#244F3B] focus:ring-[#244F3B]"
            />
            <span>Include review details in PDF export</span>
          </label>

          {/* Secondary Options */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#F0ECE3]">
            <button
              type="button"
              onClick={handleCopyMdClick}
              className="py-2 px-3 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#18221E] transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
            >
              {copiedMd ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#55635C]" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onNewProtocol}
              className="py-2 px-3 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#244F3B] transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>New protocol</span>
            </button>
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
              <p className="text-[11px] font-mono text-[#8C5921] font-semibold mt-0.5">
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
              <div className="flex items-center justify-between gap-2 text-[#8C5921]">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#D4882C] shrink-0" />
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
      {phase === 'review' && (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs sm:text-sm font-bold text-[#18221E]">
                Your review needed
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#FBF5EB] text-[#8C5921] border border-[#EEDDC3]">
                ACTION REQUIRED
              </span>
            </div>
            <p className="text-xs text-[#55635C]">
              Approving locks this version and unlocks export.
            </p>
          </div>

          {isRevisionRequested ? (
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#CDE0D4] flex items-center justify-center gap-2 text-xs font-semibold text-[#244F3B]">
              <Loader2 className="w-4 h-4 animate-spin text-[#244F3B]" />
              <span>Revision requested · agents working</span>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Primary: Approve & finalize */}
              <button
                type="button"
                onClick={onApprove}
                className="w-full py-3 px-4 rounded-xl bg-[#244F3B] hover:bg-[#1B3D2E] active:scale-[0.99] text-white text-xs sm:text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Approve & finalize</span>
              </button>

              {/* View AI Review Details Button */}
              {onOpenReviewDetails && (
                <button
                  type="button"
                  onClick={onOpenReviewDetails}
                  className="w-full py-2 px-3 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#244F3B] transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />
                  <span>View AI Review Details & Rubrics</span>
                </button>
              )}

              {/* Secondary: Edit draft & Request revision */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onStartEditing}
                  className="py-2 px-3 rounded-lg bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-xs font-semibold text-[#55635C] hover:text-[#18221E] transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B]"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#7E8F87]" />
                  <span>Edit draft</span>
                </button>

                {/* Request revision popover (C7) */}
                <Popover.Root open={isRevisionPopoverOpen} onOpenChange={setIsRevisionPopoverOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="py-2 px-3 rounded-lg bg-white hover:bg-[#FDF6E2] border border-[#F6E0B5] text-xs font-semibold text-[#8C4A26] transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C4A26]"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#8C4A26]" />
                      <span>Request revision</span>
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
                          <span className="text-[10px] uppercase font-bold text-[#7C8B82]">Open Concerns:</span>
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
          )}
        </div>
      )}
    </motion.div>
  )
}
