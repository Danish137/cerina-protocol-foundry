import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck, Heart, Stethoscope, HelpCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { ScoreData } from '../types'

interface ScoreMetersProps {
  scores?: ScoreData
  previousScores?: ScoreData
}

interface MeterRowProps {
  label: string
  icon: React.ReactNode
  currentScore?: number
  maxScore: number
  threshold: number
  formatValue: (score?: number) => string
  delta?: number
  rationale?: string
  unavailable?: boolean
}

function MeterRow({
  label,
  icon,
  currentScore,
  maxScore,
  threshold,
  formatValue,
  delta,
  rationale,
  unavailable
}: MeterRowProps) {
  const shouldReduceMotion = useReducedMotion()
  const isPending = currentScore === undefined && !unavailable
  const pct = currentScore !== undefined ? Math.min(100, Math.max(0, (currentScore / maxScore) * 100)) : 0
  const thresholdPct = (threshold / maxScore) * 100

  const isAtThreshold = currentScore !== undefined && Math.abs(currentScore - threshold) < 0.05
  const isBelow = currentScore !== undefined && currentScore < threshold

  return (
    <div className="space-y-1 p-2 rounded-xl bg-[#FAF8F5] border border-[#F0ECE3]">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-medium text-[#18221E] min-w-0">
          {icon}
          <span className="truncate">{label}</span>
          {rationale && !unavailable && (
            <div className="group relative cursor-pointer text-[#A0ACA5] hover:text-[#55635C] shrink-0">
              <HelpCircle className="w-3 h-3" />
              <div className="hidden group-hover:block absolute bottom-full left-0 mb-1 w-60 p-2 bg-[#1F2923] text-white text-[11px] rounded-lg shadow-lg z-30 pointer-events-none">
                {rationale}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 font-mono text-xs shrink-0">
          {unavailable ? (
            <span className="text-[11px] text-[#8C4A26] font-medium">Unavailable</span>
          ) : isPending ? (
            <span className="text-[#A0ACA5]">—</span>
          ) : (
            <span className="font-bold text-[#18221E]">{formatValue(currentScore)}</span>
          )}

          {delta !== undefined && delta !== 0 && !unavailable && (
            <span
              className={`text-[10px] font-bold px-1 rounded flex items-center gap-0.5 ${
                delta > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
              aria-label={`Score changed by ${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
            >
              {delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
              <span>{delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Progress Track: Dashed if pending, else 600ms animated fill with threshold tick */}
      <div className="relative h-1.5 rounded-full overflow-hidden bg-[#E8E4DA]/60">
        {isPending ? (
          <div className="w-full h-full border-t border-dashed border-[#A0ACA5]" />
        ) : unavailable ? (
          <div className="w-full h-full bg-[#E5E7EB]" />
        ) : (
          <>
            <motion.div
              className={`h-full rounded-full ${
                isBelow ? 'bg-[#DC2626]' : isAtThreshold ? 'bg-[#D97706]' : 'bg-[#244F3B]'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
            />
            {/* Threshold tick */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-black/40 z-10"
              style={{ left: `${thresholdPct}%` }}
              title={`Minimum threshold: ${threshold}`}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default function ScoreMeters({ scores = {}, previousScores: _previousScores = {} }: ScoreMetersProps) {
  const isUnavailable = scores.unavailable || scores.score_source === 'unavailable'
  // All three scores must exist before evaluating pass/fail status (P0-2)
  const hasAllScores =
    scores.safety_score !== undefined &&
    scores.empathy_score !== undefined &&
    scores.clinical_score !== undefined

  // Derive Badge per C3
  let badgeLabel = 'Pending'
  let badgeClass = 'bg-[#FAF8F5] text-[#55635C] border-[#E8E4DA]'

  if (isUnavailable) {
    badgeLabel = 'Automated check unavailable'
    badgeClass = 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]'
  } else if (hasAllScores) {
    const safePass = (scores.safety_score ?? 0) >= 0.8
    const empPass = (scores.empathy_score ?? 0) >= 3.5
    const clinPass = (scores.clinical_score ?? 0) >= 3.5

    const atThreshold =
      Math.abs((scores.safety_score ?? 0) - 0.8) < 0.05 ||
      Math.abs((scores.empathy_score ?? 0) - 3.5) < 0.1 ||
      Math.abs((scores.clinical_score ?? 0) - 3.5) < 0.1

    if (!safePass || !empPass || !clinPass) {
      badgeLabel = 'Needs revision'
      badgeClass = 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
    } else if (atThreshold) {
      badgeLabel = 'At threshold'
      badgeClass = 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]'
    } else {
      badgeLabel = 'Thresholds met'
      badgeClass = 'bg-[#EBF3EE] text-[#1E3D2F] border-[#C2DBCB]'
    }
  }

  const sChecks = scores.safety_checks
  const passedChecks = sChecks ? Object.values(sChecks).filter(Boolean).length : undefined
  const totalChecks = sChecks ? Object.keys(sChecks).length : 5

  return (
    <div className="bg-white border border-[#E8E4DA] rounded-2xl p-4 shadow-2xs space-y-3 select-none">
      <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#244F3B]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#18221E]">Clinical Rubrics</h3>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="space-y-2">
        {/* Safety Rubric */}
        <MeterRow
          label="Safety Guardian"
          icon={<ShieldCheck className="w-3.5 h-3.5 text-[#244F3B]" />}
          currentScore={scores.safety_score !== undefined ? scores.safety_score * 5 : undefined}
          maxScore={5}
          threshold={4.0}
          formatValue={() => (passedChecks !== undefined ? `${passedChecks}/${totalChecks} checks` : '—')}
          delta={scores.delta_safety !== undefined ? scores.delta_safety * 5 : undefined}
          rationale={
            passedChecks !== undefined
              ? passedChecks === totalChecks
                ? 'All 5 clinical safety parameters passed without contraindications.'
                : `${totalChecks - passedChecks} safety items flagged for clinician review.`
              : undefined
          }
          unavailable={isUnavailable}
        />

        {/* Empathy Dimension */}
        <MeterRow
          label="Empathy & Alliance"
          icon={<Heart className="w-3.5 h-3.5 text-[#244F3B]" />}
          currentScore={scores.empathy_score}
          maxScore={5}
          threshold={3.5}
          formatValue={(val) => (val !== undefined ? `${val.toFixed(1)} / 5` : '—')}
          delta={scores.delta_empathy}
          rationale={
            scores.dimensions?.warmth?.rationale ||
            'Evaluates emotional validation, tone warmth, and therapeutic alliance.'
          }
          unavailable={isUnavailable}
        />

        {/* Clinical Fidelity Dimension */}
        <MeterRow
          label="CBT Fidelity"
          icon={<Stethoscope className="w-3.5 h-3.5 text-[#244F3B]" />}
          currentScore={scores.clinical_score}
          maxScore={5}
          threshold={3.5}
          formatValue={(val) => (val !== undefined ? `${val.toFixed(1)} / 5` : '—')}
          delta={scores.delta_clinical}
          rationale={
            scores.dimensions?.structure?.rationale ||
            'Verifies evidence-based cognitive restructuring and behavioral steps.'
          }
          unavailable={isUnavailable}
        />
      </div>
    </div>
  )
}
