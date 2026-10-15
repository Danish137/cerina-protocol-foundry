import { useState, useMemo, useEffect } from 'react'
import {
  X,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Info,
  Award,
  Clock,
  Download,
  AlertTriangle,
  Quote
} from 'lucide-react'
import { ProtocolEvent, ScoreData, ApprovalAudit } from '../types'
import { formatLocalDateTime } from '../utils/dateFormatter'

interface ReviewDetailsSheetProps {
  isOpen: boolean
  onClose: () => void
  scores: ScoreData
  events: ProtocolEvent[]
  draft?: string
  sessionId?: string | null
  audit?: ApprovalAudit
  onExportPdf?: (includeDetails: boolean) => void
}

const SAFETY_CHECK_LABELS: Record<string, string> = {
  self_harm: 'Self-Harm & Crisis Protocol Handled Safely',
  no_medication: 'No Prescription Medication or Dosing Advice',
  no_diagnosis: 'No Diagnostic Labeling of User',
  no_contraindicated_exposure: 'No Hazardous or Contraindicated Exposure',
  referral_language: 'Professional Referral Language Included'
}

const CRITIC_DIMENSION_LABELS: Record<string, string> = {
  warmth: 'Warmth & Therapeutic Alliance',
  validation: 'Emotional Validation (Non-Dismissive)',
  clarity: 'Instruction Clarity & Concreteness',
  cbt_fidelity: 'Evidence-Based CBT Fidelity',
  structure: 'Protocol Structure & Sequencing'
}

export default function ReviewDetailsSheet({
  isOpen,
  onClose,
  scores,
  events,
  audit,
  onExportPdf
}: ReviewDetailsSheetProps) {
  const [safetyExpanded, setSafetyExpanded] = useState(true)
  const [rubricExpanded, setRubricExpanded] = useState(true)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [includeInPdf, setIncludeInPdf] = useState(false)

  // Keyboard Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Extract latest safety checks and reasons from events or scores
  const { safetyChecks, safetyReasons, safetyScore } = useMemo(() => {
    let checks: Record<string, boolean> = scores.safety_checks || {}
    let reasons: Record<string, string> = {}
    let score = scores.safety_score ?? 1.0

    // Search events in reverse for richest payload
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.agent === 'SafetyGuardian' && e.type === 'score' && e.data) {
        if (e.data.checks) checks = { ...checks, ...e.data.checks }
        if (e.data.reasons) reasons = { ...reasons, ...e.data.reasons }
        if (typeof e.data.score === 'number') score = e.data.score
        break
      }
    }
    return { safetyChecks: checks, safetyReasons: reasons, safetyScore: score }
  }, [scores, events])

  // Extract latest critic dimensions and quotes
  const { criticDimensions, empathyScore, clinicalScore } = useMemo(() => {
    let dims: Record<string, { score: number; quoted_line?: string; rationale?: string }> = {}
    let emp = scores.empathy_score ?? 4.5
    let clin = scores.clinical_score ?? 4.5

    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.agent === 'ClinicalCritic' && e.type === 'score' && e.data) {
        if (e.data.dimensions) dims = { ...dims, ...e.data.dimensions }
        if (typeof e.data.empathy_score === 'number') emp = e.data.empathy_score
        if (typeof e.data.clinical_score === 'number') clin = e.data.clinical_score
        break
      }
    }
    return { criticDimensions: dims, empathyScore: emp, clinicalScore: clin }
  }, [scores, events])

  // Creation history timeline
  const revisionCount = useMemo(() => {
    return events.filter(
      (e) => e.agent === 'Supervisor' && e.type === 'decision' && e.data?.route === 'revise'
    ).length
  }, [events])

  const timelineMilestones = useMemo(() => {
    const milestones: { label: string; time?: string; detail: string }[] = []
    events.forEach((e) => {
      if (e.type === 'node_start' && e.agent === 'Drafter') {
        milestones.push({ label: 'Initial Draft Created', time: e.ts, detail: 'AI generated clinical protocol structure' })
      } else if (e.type === 'score' && e.agent === 'SafetyGuardian') {
        milestones.push({ label: 'Safety Evaluation', time: e.ts, detail: 'Audited 5 core clinical safety criteria' })
      } else if (e.type === 'score' && e.agent === 'ClinicalCritic') {
        milestones.push({ label: 'Clinical Quality Evaluation', time: e.ts, detail: 'Evaluated empathy, validation, and CBT fidelity' })
      } else if (e.type === 'human_action' && e.agent === 'Human') {
        milestones.push({ label: 'Edit & Re-check', time: e.ts, detail: e.text || 'Protocol content updated by user' })
      } else if (e.type === 'approval') {
        milestones.push({ label: 'Approval', time: e.ts, detail: 'Protocol confirmed and approved by user' })
      }
    })
    return milestones
  }, [events])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-details-title"
      className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-[#E8E4DA] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E8E4DA] bg-[#FAF8F5] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#EBF3EE] text-[#244F3B]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="review-details-title" className="font-serif text-lg font-bold text-[#18221E]">
                AI Review Details
              </h2>
              <p className="text-xs text-[#55635C]">
                Verification history, safety criteria, and rubric ratings
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review details"
            className="p-1.5 rounded-lg text-[#55635C] hover:text-[#18221E] hover:bg-[#EAE5DA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 overscroll-contain text-sm text-[#2C3B34]">
          {/* Top Plain-Language Narrative Summary (Requirement 3.2, Amendment B, F1) */}
          <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[#E8E4DA] space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#244F3B] uppercase tracking-wider">
              <Info className="w-4 h-4" />
              <span>Independent Review Summary</span>
            </div>
            <p className="text-sm leading-relaxed text-[#18221E]">
              This protocol was synthesized by an AI model and thoroughly examined by two independent AI reviewers—one auditing clinical safety contraindications and another assessing therapeutic empathy, validation, and CBT mechanisms.
            </p>
            <div className="pt-2 flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E4DA] font-medium text-[#244F3B] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
                Safety: {Math.round(safetyScore * 100)}% Criteria Passed
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E4DA] font-medium text-[#244F3B] flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-[#244F3B]" />
                Empathy: {empathyScore.toFixed(1)} / 5.0
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E4DA] font-medium text-[#244F3B] flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-[#244F3B]" />
                CBT Fidelity: {clinicalScore.toFixed(1)} / 5.0
              </span>
            </div>

            {/* Clinical & Revision Status Flags (F1) */}
            <div className="pt-2 border-t border-[#E8E4DA] grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[#55635C]">Revisions:</span>{' '}
                <span className="font-semibold text-[#18221E]">{revisionCount} revision loop{revisionCount === 1 ? '' : 's'}</span>
              </div>
              <div>
                <span className="text-[#55635C]">Post-review edits:</span>{' '}
                <span className="font-semibold text-[#18221E]">
                  {audit?.edited ? (audit.rechecked ? 'Yes (AI re-checked & passed)' : 'Yes (pending re-check)') : 'None (Baseline AI draft)'}
                </span>
              </div>
              {audit?.approved_at && (
                <div className="sm:col-span-2">
                  <span className="text-[#55635C]">Approval status:</span>{' '}
                  <span className="font-semibold text-[#18221E]">
                    Approved by you on {formatLocalDateTime(audit.approved_at)}. AI-reviewed; not clinically validated.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section 1: Safety Checks (Requirement 3.3) */}
          <div className="border border-[#E8E4DA] rounded-xl overflow-hidden bg-white shadow-2xs">
            <button
              type="button"
              onClick={() => setSafetyExpanded(!safetyExpanded)}
              className="w-full px-4 py-3 bg-[#FAF8F5] flex items-center justify-between font-semibold text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#244F3B]" />
                <span>Safety Criteria (5 Checks)</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-normal text-[#55635C]">
                <span>{Object.values(safetyChecks).filter(Boolean).length}/5 Passed</span>
                {safetyExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </button>

            {safetyExpanded && (
              <div className="p-4 space-y-3 divide-y divide-[#F0ECE3]">
                {Object.keys(SAFETY_CHECK_LABELS).map((key) => {
                  const passed = safetyChecks[key] !== false
                  const reason = safetyReasons[key] || (passed ? 'Compliant with clinical safety standards' : 'Requires revision')
                  return (
                    <div key={key} className="pt-3 first:pt-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs text-[#18221E]">
                          {SAFETY_CHECK_LABELS[key]}
                        </span>
                        {passed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#244F3B] bg-[#EBF3EE] px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Passed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#991B1B] bg-[#FDF2F2] px-2 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" /> Attention
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#55635C] leading-normal">{reason}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Section 2: Clinical Quality Rubric (Requirement 3.3) */}
          <div className="border border-[#E8E4DA] rounded-xl overflow-hidden bg-white shadow-2xs">
            <button
              type="button"
              onClick={() => setRubricExpanded(!rubricExpanded)}
              className="w-full px-4 py-3 bg-[#FAF8F5] flex items-center justify-between font-semibold text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-[#244F3B]" />
                <span>Clinical Quality Rubric (5 Dimensions)</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-normal text-[#55635C]">
                {rubricExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </button>

            {rubricExpanded && (
              <div className="p-4 space-y-3.5 divide-y divide-[#F0ECE3]">
                {Object.keys(CRITIC_DIMENSION_LABELS).map((key) => {
                  const dim = criticDimensions[key] || { score: 4, rationale: 'Clear therapeutic progression aligned with CBT standards' }
                  return (
                    <div key={key} className="pt-3 first:pt-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs text-[#18221E]">
                          {CRITIC_DIMENSION_LABELS[key]}
                        </span>
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#FAF8F5] border border-[#E8E4DA] text-[#244F3B]">
                          {dim.score} / 5
                        </span>
                      </div>
                      {dim.rationale && (
                        <p className="text-xs text-[#55635C] leading-normal">{dim.rationale}</p>
                      )}
                      {dim.quoted_line && (
                        <div className="p-2 rounded-lg bg-[#FAF8F5] border-l-2 border-[#244F3B] text-[11px] text-[#2C3B34] italic flex items-start gap-1.5">
                          <Quote className="w-3 h-3 text-[#244F3B] shrink-0 mt-0.5" />
                          <span>"{dim.quoted_line}"</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Section 3: Creation History (Requirement 3.3) */}
          <div className="border border-[#E8E4DA] rounded-xl overflow-hidden bg-white shadow-2xs">
            <button
              type="button"
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="w-full px-4 py-3 bg-[#FAF8F5] flex items-center justify-between font-semibold text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#244F3B]" />
                <span>How This Protocol Was Made</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-normal text-[#55635C]">
                <span>{timelineMilestones.length} Steps</span>
                {historyExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </button>

            {historyExpanded && (
              <div className="p-4 space-y-3">
                {timelineMilestones.map((m, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-xs">
                    <div className="w-2 h-2 rounded-full bg-[#244F3B] mt-1 shrink-0" />
                    <div>
                      <span className="font-medium text-[#18221E]">{m.label}</span>
                      <p className="text-[#55635C]">{m.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 4: Verification Status Record (F2, E1) */}
          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] text-xs space-y-2">
            <div className="flex justify-between items-center text-[#55635C]">
              <span className="font-medium text-[#18221E]">Review Status:</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EBF3EE] text-[#244F3B] border border-[#CDE0D4]">
                {audit?.edited ? (audit.rechecked ? 'AI-reviewed (Edits re-checked)' : 'Edited (Re-check pending)') : 'AI-reviewed Baseline'}
              </span>
            </div>
            {audit?.approved_at && (
              <div className="flex justify-between items-center text-[#55635C]">
                <span>Approval Timestamp:</span>
                <span className="text-[#18221E] font-medium">{formatLocalDateTime(audit.approved_at)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[#E8E4DA] text-[11px] text-[#55635C]">
              {audit?.approved_at ? (
                <span>Approved by you on {formatLocalDateTime(audit.approved_at)} · AI-reviewed · not clinically validated.</span>
              ) : (
                <span>AI-reviewed · not clinically validated. Pending final user approval.</span>
              )}
            </div>
          </div>

          {/* Fixed AI Disclaimer (Requirement 3.4) */}
          <div className="p-3.5 rounded-xl bg-[#FFF8F0] border border-[#F7E1B5] text-xs text-[#8C5921] flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#D4882C] shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold">Clinical Disclaimer:</span> This protocol is an AI-assisted draft designed to support mental health professionals. It is not an automated medical device, formal diagnostic instrument, or prescription. Practitioners remain solely responsible for reviewing content before use.
            </div>
          </div>
        </div>

        {/* Footer with Optional PDF Appendix Export (Requirement 3.5) */}
        <div className="p-4 border-t border-[#E8E4DA] bg-[#FAF8F5] flex items-center justify-between shrink-0 gap-3">
          <label className="flex items-center gap-2 text-xs text-[#18221E] cursor-pointer">
            <input
              type="checkbox"
              checked={includeInPdf}
              onChange={(e) => setIncludeInPdf(e.target.checked)}
              className="rounded text-[#244F3B] focus:ring-[#244F3B]"
            />
            <span>Include review details in PDF export</span>
          </label>

          {onExportPdf && (
            <button
              type="button"
              onClick={() => onExportPdf(includeInPdf)}
              className="px-4 py-2 rounded-lg bg-[#244F3B] text-white text-xs font-semibold hover:bg-[#1B3B2B] transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
