import React, { useState, useEffect, useRef } from 'react'
import { ArrowRight, Loader2, Bookmark, Sparkles, ShieldAlert, PlayCircle } from 'lucide-react'
import axios from 'axios'
import API_BASE_URL from '../config'
import { useToast } from './Toast'
import { CapacityStatus, StoredSession } from '../types'
import { getRecentSessions } from '../services/sessionStorage'

interface ProtocolCreatorProps {
  onSessionStart: (session: {
    sessionId: string
    sessionToken: string
    status: string
    intent: string
    reviewDepth: 'standard' | 'thorough'
    careResources?: any
  }) => void
  onResumeSession?: (session: StoredSession) => void
  onWatchRecordedRun?: () => void
}

const STARTER_CHIPS = [
  {
    label: 'Exam anxiety',
    prompt: "I have a major exam coming up and I'm feeling overwhelmed with anxiety, convinced I'll fail no matter how much I study.",
  },
  {
    label: 'Procrastination',
    prompt: "I keep putting off an important task because I feel it has to be perfect, and now the deadline is tomorrow.",
  },
  {
    label: 'Social anxiety before an event',
    prompt: "I'm attending a large gathering this weekend and I'm anxious that everyone will judge me or that I'll say something stupid.",
  },
  {
    label: 'Trouble sleeping because of worry',
    prompt: "I can't fall asleep because my mind races with worries about work, future problems, and things I cannot control right now.",
  },
  {
    label: 'Challenge a negative thought',
    prompt: "I made a small mistake at work and now I have a recurring thought that 'I am completely incompetent and everyone knows it'.",
  },
]

export default function ProtocolCreator({ onSessionStart, onResumeSession, onWatchRecordedRun }: ProtocolCreatorProps) {
  const { showToast } = useToast()
  const [intent, setIntent] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const reviewDepth: 'standard' | 'thorough' = 'standard'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capacity, setCapacity] = useState<CapacityStatus | null>(null)
  const [recentSessions, setRecentSessions] = useState<StoredSession[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setRecentSessions(getRecentSessions())
  }, [])

  // Fetch live capacity status
  useEffect(() => {
    async function fetchCapacity() {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/capacity`)
        setCapacity(res.data)
      } catch (err) {
        console.warn('Failed to load capacity estimate:', err)
      }
    }
    fetchCapacity()
  }, [])

  const handleSelectTemplate = (prompt: string, label: string) => {
    setSelectedTemplate(label)
    setIntent(prompt)
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const handleSubmit = async (e?: React.FormEvent, crisisBypass: boolean = false) => {
    if (e) e.preventDefault()
    const activeIntent = intent.trim()
    if (activeIntent.length < 10) {
      showToast('Please describe your exercise in at least 10 characters', 'error')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await axios.post(`${API_BASE_URL}/api/protocols/create`, {
        intent: activeIntent,
        review_depth: reviewDepth,
        crisis_bypass: crisisBypass,
        region_code: 'US'
      })

      showToast('Exercise creation initialized', 'success')
      onSessionStart({
        sessionId: response.data.session_id,
        sessionToken: response.data.session_token,
        status: response.data.status,
        intent: activeIntent,
        reviewDepth: response.data.review_depth || reviewDepth,
        careResources: response.data.care_resources
      })
    } catch (err: any) {
      let errorMessage = 'Failed to create exercise'
      if (err.response) {
        if (err.response.status === 429) {
          errorMessage = 'Daily demonstration quota reached. Watch a recorded run below.'
        } else {
          errorMessage =
            err.response.data?.detail?.message ||
            err.response.data?.detail ||
            err.response.data?.message ||
            `Server error: ${err.response.status}`
        }
      } else if (err.request) {
        errorMessage = `No response from backend at ${API_BASE_URL}. Is server running?`
      } else {
        errorMessage = `Request error: ${err.message}`
      }
      setError(errorMessage)
      showToast(errorMessage, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Quota Exhausted friendly state (B4)
  if (capacity?.exhausted) {
    return (
      <div className="bg-white border border-[#E8E4DA] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3 text-[#B45309]">
          <ShieldAlert className="w-6 h-6" />
          <h3 className="font-serif font-semibold text-lg text-[#1F2923]">Daily AI Capacity Reached</h3>
        </div>
        <p className="text-sm text-[#55635C] leading-relaxed">
          Today's live AI generation capacity ({capacity.daily_budget} calls) has been fully utilized.
          You can experience the complete interactive exercise workflow through our recorded run replay without consuming live AI credits.
        </p>
        <button
          onClick={onWatchRecordedRun}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#244F3B] text-white font-medium text-sm hover:bg-[#1B3B2B] transition-colors shadow-sm"
        >
          <PlayCircle className="w-4 h-4" />
          Watch a Recorded Run
        </button>
      </div>
    )
  }

  return (
    <div
      className="bg-white border border-[#E8E4DA] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4"
    >
      {/* Card Header & Capacity Chip */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#EBF3EE] text-[#244F3B]">
            <Bookmark className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1F2923]">What's on your mind?</h2>
            <p className="text-xs text-[#5C6A62]">Describe the situation or thought pattern you want to work through</p>
          </div>
        </div>

        {/* Capacity Chip: show only when <= 5 */}
        {capacity && capacity.remaining_runs_estimate <= 5 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF8F5] border border-[#E8E4DA] text-xs font-medium text-[#55635C]">
            <span className="w-2 h-2 rounded-full bg-[#B45309]"></span>
            <span>Approx. {capacity.remaining_runs_estimate} live runs left today</span>
          </div>
        )}
      </div>

      {/* Continue Recent Session Banner (B2) */}
      {recentSessions.length > 0 && onResumeSession && (
        <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0">
            <span className="text-[#5C6A62] font-medium">Continue: </span>
            <span className="font-semibold text-[#1F2923] truncate inline-block max-w-[260px] sm:max-w-[340px] align-bottom">
              {recentSessions[0].intent}
            </span>
            <span className="text-[#5C6A62] ml-1.5 capitalize">· {recentSessions[0].status}</span>
          </div>
          <button
            type="button"
            onClick={() => onResumeSession(recentSessions[0])}
            className="shrink-0 px-3 py-1 rounded-md bg-[#244F3B] text-white text-xs font-medium hover:bg-[#1B3B2B] transition-colors shadow-2xs"
          >
            Open
          </button>
        </div>
      )}

      <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4">
        {/* Intent Textarea */}
        <div className="relative">
          <textarea
            id="intent-input"
            name="intent"
            ref={textareaRef}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g., I have an important presentation on Friday and I keep thinking I'm going to freeze and embarrass myself..."
            className="w-full h-32 px-4 py-3 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] text-sm text-[#1F2923] placeholder-[#A0ACA5] focus:outline-none focus:ring-2 focus:ring-[#244F3B] focus:border-transparent resize-none leading-relaxed transition-all"
            disabled={loading}
          />
        </div>

        {/* Starter Chips */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#5C6A62]">
            <Sparkles className="w-3.5 h-3.5 text-[#244F3B]" />
            <span>Try an example:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {STARTER_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleSelectTemplate(chip.prompt, chip.label)}
                disabled={loading}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedTemplate === chip.label
                    ? 'bg-[#244F3B] text-white shadow-sm'
                    : 'bg-[#F4F1EA] text-[#55635C] hover:bg-[#EAE5DA]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Review Depth Toggle (B4) & Submit Button */}
        <div className="pt-3 border-t border-[#F0ECE3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
          </div>

          <div className="flex items-center gap-3">
            {onWatchRecordedRun && (
              <button
                type="button"
                onClick={onWatchRecordedRun}
                className="text-xs text-[#55635C] hover:text-[#244F3B] underline font-medium"
              >
                Watch a recorded run
              </button>
            )}
            <button
              type="submit"
              disabled={loading || intent.trim().length < 10}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#244F3B] text-white font-medium text-sm hover:bg-[#1B3B2B] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating exercise...</span>
                </>
              ) : (
                <>
                  <span>Create Exercise</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Demo Disclaimer (Decision A) */}
        <p className="text-[11px] text-[#5C6A62] text-center pt-1">
          This is a demo. Describe the situation in general terms; don't include names, contact details or personal health information.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-[#FDF2F2] border border-[#F8D7DA] text-xs text-[#991B1B]">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}