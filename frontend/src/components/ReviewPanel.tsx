import { useState } from 'react'
import { ShieldCheck, Heart, Stethoscope, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Edit3 } from 'lucide-react'
import { ProtocolState, ReviewerSuggestion } from '../types'

interface ReviewPanelProps {
  state: ProtocolState | null
  onApplySuggestion?: (text: string) => void
}

export default function ReviewPanel({ state, onApplySuggestion }: ReviewPanelProps) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false)

  const safetyScore = state?.safety_score ?? 0.8
  const empathyScore = state?.empathy_score ?? 0.7
  const clinicalScore = state?.clinical_score ?? 0.7

  const scores = [
    {
      id: 'safety',
      label: 'Safety Score',
      value: safetyScore,
      threshold: 0.8,
      icon: <ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />,
      passed: safetyScore >= 0.8,
    },
    {
      id: 'empathy',
      label: 'Therapeutic Empathy',
      value: empathyScore,
      threshold: 0.7,
      icon: <Heart className="w-3.5 h-3.5 text-[#2B6CB0]" />,
      passed: empathyScore >= 0.7,
    },
    {
      id: 'clinical',
      label: 'Clinical Fidelity',
      value: clinicalScore,
      threshold: 0.7,
      icon: <Stethoscope className="w-3.5 h-3.5 text-[#553C9A]" />,
      passed: clinicalScore >= 0.7,
    },
  ]

  // Parse reviewer suggestions from agent_notes
  const suggestions: ReviewerSuggestion[] = []
  if (state?.agent_notes) {
    state.agent_notes.forEach((note, idx) => {
      const rawText = note.note || ''
      if (
        rawText.includes('IMPROVEMENT NEEDED:') ||
        rawText.includes('SAFETY ISSUE:') ||
        rawText.includes('RECOMMENDATION:')
      ) {
        const cleanText = rawText
          .replace(/^IMPROVEMENT NEEDED:\s*/i, '')
          .replace(/^SAFETY ISSUE:\s*/i, '')
          .replace(/^RECOMMENDATION:\s*/i, '')
          .trim()

        if (cleanText) {
          suggestions.push({
            id: `sug-${idx}`,
            agentId: note.agent_name || 'Reviewer',
            agentLabel: note.agent_name || 'Reviewer',
            message: cleanText,
            severity: 'warning',
            agent: note.agent_name || 'Reviewer',
            text: cleanText,
            priority: note.priority || 'warning',
            createdAt: note.timestamp,
          })
        }
      }
    })
  }

  const displayedSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, 3)

  const allPassed = scores.every((s) => s.passed)

  return (
    <div className="bg-white border border-[#E8E4DA] rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
      {/* Header & Supervisor Consensus */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0ECE3]">
        <div>
          <h3 className="text-xs sm:text-sm font-semibold text-[#18221E] font-sans">
            Specialist Review & Metrics
          </h3>
          <p className="text-[11px] text-[#55635C] mt-0.5">
            {allPassed
              ? `Meets quality thresholds · ${suggestions.length} suggestions`
              : `Review in progress · ${suggestions.length} suggestions noted`}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            allPassed
              ? 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]'
              : 'bg-[#FBF5EB] text-[#8C5921] border-[#EEDDC3]'
          }`}
        >
          {allPassed ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
              <span>Passed</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-[#D4882C]" />
              <span>Needs Check</span>
            </>
          )}
        </div>
      </div>

      {/* 3 Metric Meters with Threshold Ticks */}
      <div className="space-y-3">
        {scores.map((score) => {
          const pct = Math.round(score.value * 100)
          const thresholdPct = Math.round(score.threshold * 100)

          return (
            <div key={score.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-[#18221E]">
                  {score.icon}
                  <span>{score.label}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="font-semibold text-[#18221E]">{pct}%</span>
                  <span className="text-[#88978F]">(req: {thresholdPct}%)</span>
                  {score.passed ? (
                    <span title="Passed threshold"><CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" /></span>
                  ) : (
                    <span title="Below threshold"><AlertTriangle className="w-3.5 h-3.5 text-[#D4882C]" /></span>
                  )}
                </div>
              </div>

              {/* Progress Bar Container with Tick */}
              <div className="relative w-full h-2 bg-[#F0ECE3] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    score.passed ? 'bg-[#244F3B]' : 'bg-[#D4882C]'
                  }`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                {/* Threshold Marker Tick */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[#18221E] opacity-40 z-10"
                  style={{ left: `${thresholdPct}%` }}
                  title={`Threshold: ${thresholdPct}%`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Reviewer Suggestions Section */}
      {suggestions.length > 0 && (
        <div className="pt-2 border-t border-[#F0ECE3] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#55635C]">
              Reviewer Suggestions ({suggestions.length})
            </span>
          </div>

          <div className="space-y-2">
            {displayedSuggestions.map((sug) => (
              <div
                key={sug.id}
                className="p-2.5 rounded-lg border border-[#E8E4DA] bg-[#FAF8F5] text-xs space-y-1.5 hover:border-[#D8D2C4] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#18221E] text-[11px]">
                    {sug.agent}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                      sug.priority === 'critical'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : sug.priority === 'warning'
                        ? 'bg-[#FBF5EB] text-[#8C5921] border-[#EEDDC3]'
                        : 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]'
                    }`}
                  >
                    {sug.priority === 'critical' ? 'Critical' : sug.priority === 'warning' ? 'Warning' : 'Suggestion'}
                  </span>
                </div>

                <p className="text-[11.5px] text-[#55635C] leading-relaxed">
                  {sug.text}
                </p>

                {onApplySuggestion && (
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(sug.text || sug.message || '')}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#244F3B] hover:text-[#1B3D2E] hover:underline focus:outline-none"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Apply when editing</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {suggestions.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllSuggestions((prev) => !prev)}
              className="w-full text-center py-1 text-[11px] font-medium text-[#55635C] hover:text-[#18221E] flex items-center justify-center gap-1"
            >
              <span>{showAllSuggestions ? 'Show fewer' : `Show all ${suggestions.length} suggestions`}</span>
              {showAllSuggestions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
