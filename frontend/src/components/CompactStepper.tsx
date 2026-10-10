import { Fragment } from 'react'
import { Check } from 'lucide-react'
import { Phase, StepConfig } from '../types'

interface CompactStepperProps {
  phase: Phase
  activeAgent?: string
  onStepClick?: (stepNumber: number) => void
}

export function getStepperSteps(phase: Phase, activeAgent?: string): StepConfig[] {
  switch (phase) {
    case 'idle':
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'current' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'upcoming' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'upcoming' },
        { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
        { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
      ]

    case 'generating':
      if (activeAgent === 'SafetyGuardian' || activeAgent === 'ClinicalCritic' || activeAgent === 'Supervisor') {
        return [
          { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'completed' },
          { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'completed' },
          { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'current' },
          { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
          { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
        ]
      }
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'completed' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'current' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'upcoming' },
        { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
        { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
      ]

    case 'review':
    case 'editing':
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'completed' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'completed' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'completed' },
        { number: 4, title: 'Human review', subtitle: phase === 'editing' ? 'Active edits' : 'Edit & approve', state: 'current' },
        { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
      ]

    case 'approving':
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'completed' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'completed' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'completed' },
        { number: 4, title: 'Human review', subtitle: 'Finalizing...', state: 'current' },
        { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
      ]

    case 'approved':
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'completed' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'completed' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'completed' },
        { number: 4, title: 'Human review', subtitle: 'Approved', state: 'completed' },
        { number: 5, title: 'Final protocol', subtitle: 'Export unlocked', state: 'completed' },
      ]

    default:
      return [
        { number: 1, title: 'User intent', subtitle: 'Clinical goal', state: 'current' },
        { number: 2, title: 'Drafting', subtitle: 'Structured exercise', state: 'upcoming' },
        { number: 3, title: 'Specialist review', subtitle: 'Safety & critique', state: 'upcoming' },
        { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
        { number: 5, title: 'Final protocol', subtitle: 'Ready & export', state: 'upcoming' },
      ]
  }
}

export default function CompactStepper({ phase, activeAgent, onStepClick }: CompactStepperProps) {
  const steps = getStepperSteps(phase, activeAgent)

  return (
    <nav aria-label="Workflow progress" className="flex items-center gap-1 sm:gap-2">
      {steps.map((step, idx) => {
        const isCompleted = step.state === 'completed'
        const isCurrent = step.state === 'current'
        const isHumanReview = isCurrent && step.number === 4

        return (
          <Fragment key={step.number}>
            {idx > 0 && (
              <div
                className={`w-1.5 sm:w-3.5 xl:w-5 h-[1.5px] transition-colors ${
                  isCompleted ? 'bg-[#244F3B]' : 'bg-[#E8E4DA]'
                }`}
              />
            )}

            <button
              type="button"
              onClick={() => isCompleted && onStepClick?.(step.number)}
              disabled={!isCompleted}
              title={`${step.title} (${step.subtitle}) - ${step.state}`}
              className={`group flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] focus-visible:ring-offset-2 rounded-full transition-all ${
                isCompleted ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all ${
                  isCompleted
                    ? 'bg-[#244F3B] text-white shadow-xs'
                    : isHumanReview
                    ? 'bg-[#D4882C] text-white ring-2 ring-[#F4DEC2]'
                    : isCurrent
                    ? 'bg-[#244F3B] text-white ring-2 ring-[#D1E2D7]'
                    : 'bg-[#FAF8F5] text-[#88978F] border border-[#E8E4DA]'
                }`}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                ) : (
                  <span>{step.number}</span>
                )}
              </div>

              {/* Step label: hidden below 1280px (xl) */}
              <div className="hidden xl:flex flex-col text-left pr-1">
                <span
                  className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${
                    isHumanReview
                      ? 'text-[#8C5921]'
                      : isCurrent
                      ? 'text-[#18221E]'
                      : isCompleted
                      ? 'text-[#18221E]'
                      : 'text-[#88978F]'
                  }`}
                >
                  {step.title}
                </span>
              </div>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
