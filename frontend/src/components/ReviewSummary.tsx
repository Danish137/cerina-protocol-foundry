import { useState } from 'react'
import {
  ShieldCheck,
  Heart,
  Stethoscope,
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  ListTodo,
  History,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { ProtocolState, ReviewerSuggestion } from '../types'
import SuggestionsSheet from './SuggestionsSheet'
import ActivityLogSheet, { LogEntry } from './ActivityLogSheet'

interface ReviewSummaryProps {
  state: ProtocolState | null
  suggestions: ReviewerSuggestion[]
  activityLogs: LogEntry[]
  onToggleAddressed: (id: string) => void
  onDismissSuggestion: (id: string) => void
  onOpenEdit?: () => void
}

interface ScoreMeterProps {
  label: string
  score: number | undefined
  threshold: number
  icon: React.ReactNode
  previousScore?: number
}

function CompactScoreMeter({ label, score, threshold, icon, previousScore }: ScoreMeterProps) {
  const percentage = score !== undefined ? Math.round(score * 100) : 0
  const reqPercentage = Math.round(threshold * 100)

  // Status computation:
  // - Exactly at threshold: amber 'At threshold' icon
  // - Above threshold: green pass
  // - Below threshold: red fail
  const isAtThreshold = percentage === reqPercentage
  const isPassed = percentage >= reqPercentage && !isAtThreshold
  const isFailed = percentage < reqPercentage

  // Delta calculation
  let deltaText = ''
  let deltaDirection: 'up' | 'down' | 'same' | null = null
  if (previousScore !== undefined && previousScore !== score) {
    const prevPct = Math.round(previousScore * 100)
    const diff = percentage - prevPct
    if (diff > 0) {
      deltaText = `${prevPct} → ${percentage} ↑+${diff}`
      deltaDirection = 'up'
    } else if (diff < 0) {
      deltaText = `${prevPct} → ${percentage} ↓${diff}`
      deltaDirection = 'down'
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-medium text-[#18221E]">
          {icon}
          <span>{label}</span>
          {deltaText && (
            <span
              className={`text-[10px] font-mono px-1 rounded flex items-center gap-0.5 ${
                deltaDirection === 'up'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
              aria-label={`Score changed from ${deltaText}`}
            >
              {deltaDirection === 'up' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
              {deltaText}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-[#18221E] text-xs">
            {score !== undefined ? `${percentage}%` : '—'}
          </span>
          <span className="text-[10px] text-[#55635C]">
            (req: {reqPercentage}%)
          </span>

          {score !== undefined && (
            isAtThreshold ? (
              <span role="img" title="Score is exactly at minimum threshold" className="inline-flex items-center text-[#D4882C]" aria-label="Score exactly at minimum threshold">
                <MinusCircle className="w-3.5 h-3.5 fill-[#FEF9EE] text-[#D4882C]" />
              </span>
            ) : isPassed ? (
              <span role="img" title="Passed threshold" className="inline-flex items-center text-[#244F3B]" aria-label="Passed threshold">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
              </span>
            ) : (
              <span role="img" title="Score below threshold" className="inline-flex items-center text-[#B91C1C]" aria-label="Below required threshold">
                <AlertCircle className="w-3.5 h-3.5 text-[#B91C1C]" />
              </span>
            )
          )}
        </div>
      </div>

      {/* Meter Bar with Threshold Tick */}
      <div className="relative w-full h-1.5 bg-[#E8E4DA] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isFailed
              ? 'bg-[#B91C1C]'
              : isAtThreshold
              ? 'bg-[#D4882C]'
              : 'bg-[#244F3B]'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
        {/* Tick line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-black/40 z-10"
          style={{ left: `${reqPercentage}%` }}
          title={`Threshold: ${reqPercentage}%`}
        />
      </div>
    </div>
  )
}

export default function ReviewSummary({
  state,
  suggestions,
  activityLogs,
  onToggleAddressed,
  onDismissSuggestion,
}: ReviewSummaryProps) {
  const [isSuggestionsSheetOpen, setIsSuggestionsSheetOpen] = useState(false)
  const [isActivityLogSheetOpen, setIsActivityLogSheetOpen] = useState(false)

  const visibleSuggestions = suggestions.filter((s) => !s.isDismissed)
  const topSuggestions = visibleSuggestions.slice(0, 2)
  const addressedCount = visibleSuggestions.filter((s) => s.isAddressed).length

  // Overall status check
  const sScore = state?.safety_score ?? 0.85
  const eScore = state?.empathy_score ?? 0.75
  const cScore = state?.clinical_score ?? 0.75
  const allPassed = sScore >= 0.8 && eScore >= 0.7 && cScore >= 0.7

  return (
    <div className="w-full bg-white border border-[#E8E4DA] rounded-2xl p-4 shadow-2xs space-y-3.5 shrink-0">
      {/* Title & Quality Badge */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
        <h3 className="font-serif text-sm font-bold text-[#18221E]">
          Specialist Review
        </h3>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 border ${
            allPassed
              ? 'bg-[#EBF3EE] text-[#244F3B] border-[#CDE0D4]'
              : 'bg-[#FFF8F0] text-[#8C5921] border-[#F7E1B5]'
          }`}
        >
          {allPassed ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-[#244F3B]" />
              <span>Thresholds Met</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3 h-3 text-[#8C5921]" />
              <span>Reviewing</span>
            </>
          )}
        </span>
      </div>

      {/* 3 Compact Score Meters */}
      <div className="space-y-2.5">
        <CompactScoreMeter
          label="Safety"
          score={state?.safety_score}
          threshold={0.8}
          icon={<ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />}
        />
        <CompactScoreMeter
          label="Therapeutic Empathy"
          score={state?.empathy_score}
          threshold={0.7}
          icon={<Heart className="w-3.5 h-3.5 text-[#244F3B]" />}
        />
        <CompactScoreMeter
          label="Clinical Fidelity"
          score={state?.clinical_score}
          threshold={0.7}
          icon={<Stethoscope className="w-3.5 h-3.5 text-[#244F3B]" />}
        />
      </div>

      {/* Top 2 Suggestions (One-line truncated rows) */}
      <div className="pt-2 border-t border-[#F0ECE3] space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-[#55635C]">
          <span>Reviewer Notes</span>
          <span className="text-[10px] text-[#55635C]">
            {addressedCount} of {visibleSuggestions.length} addressed
          </span>
        </div>

        {visibleSuggestions.length === 0 ? (
          <p className="text-xs text-[#55635C] italic py-1">
            No suggestions flagged by AI critics.
          </p>
        ) : (
          topSuggestions.map((sug) => {
            const severityStyle =
              sug.severity === 'critical'
                ? 'bg-[#FDF2F2] text-[#9B2C2C] border-[#F5C6C6]'
                : sug.severity === 'warning'
                ? 'bg-[#FEF9EE] text-[#8C5921] border-[#F7E1B5]'
                : 'bg-[#F4F6F4] text-[#416250] border-[#D6E2DB]'

            return (
              <div
                key={sug.id}
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] text-xs hover:bg-[#F5F2EC] transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border shrink-0 capitalize ${severityStyle}`}
                  >
                    {sug.severity}
                  </span>
                  <span
                    className={`truncate text-[11px] text-[#2C3B34] ${
                      sug.isAddressed ? 'line-through text-[#8C9B93]' : ''
                    }`}
                    title={sug.message}
                  >
                    {sug.message}
                  </span>
                </div>

                <input
                  type="checkbox"
                  aria-label={sug.isAddressed ? 'Mark suggestion unaddressed' : 'Mark suggestion addressed'}
                  checked={Boolean(sug.isAddressed)}
                  onChange={() => onToggleAddressed(sug.id)}
                  className="w-3.5 h-3.5 rounded border-[#C8C2B3] text-[#244F3B] focus:ring-1 focus:ring-[#244F3B] shrink-0 cursor-pointer"
                />
              </div>
            )
          })
        )}
      </div>

      {/* Two Modal Buttons */}
      <div className="pt-2 border-t border-[#F0ECE3] grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setIsSuggestionsSheetOpen(true)}
          className="py-1.5 px-2.5 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#18221E] transition-colors flex items-center justify-center gap-1.5"
        >
          <ListTodo className="w-3.5 h-3.5 text-[#244F3B]" />
          <span>Suggestions ({visibleSuggestions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setIsActivityLogSheetOpen(true)}
          className="py-1.5 px-2.5 rounded-lg bg-[#FAF8F5] hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#18221E] transition-colors flex items-center justify-center gap-1.5"
        >
          <History className="w-3.5 h-3.5 text-[#244F3B]" />
          <span>Activity ({activityLogs.length})</span>
        </button>
      </div>

      {/* Radix Dialog Sheets */}
      <SuggestionsSheet
        isOpen={isSuggestionsSheetOpen}
        onOpenChange={setIsSuggestionsSheetOpen}
        suggestions={suggestions}
        onToggleAddressed={onToggleAddressed}
        onDismiss={onDismissSuggestion}
      />

      <ActivityLogSheet
        isOpen={isActivityLogSheetOpen}
        onOpenChange={setIsActivityLogSheetOpen}
        entries={activityLogs}
        revisedCount={state?.iteration_count && state.iteration_count > 1 ? state.iteration_count - 1 : 0}
      />
    </div>
  )
}
