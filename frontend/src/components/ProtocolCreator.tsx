import React, { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Loader2, Bookmark, Sparkles, HelpCircle } from 'lucide-react'
import axios from 'axios'
import API_BASE_URL from '../config'
import { useToast } from './Toast'

interface ProtocolCreatorProps {
  onSessionStart: (session: { sessionId: string; status: string; intent: string }) => void
}

const TEMPLATES = [
  {
    label: 'Anxiety (Exposure)',
    prompt: 'Create a graded exposure hierarchy for someone experiencing anxiety around public speaking.',
  },
  {
    label: 'Depression (Activation)',
    prompt: 'Create a behavioral activation routine and mastery/pleasure schedule for mild depression.',
  },
  {
    label: 'Insomnia (Sleep Hygiene)',
    prompt: 'Create a stimulus control and sleep hygiene routine for persistent sleep-onset insomnia.',
  },
  {
    label: 'Thought Record (CBT)',
    prompt: 'Create a cognitive restructuring 5-column thought record for catastrophizing and negative automatic thoughts.',
  },
]

export default function ProtocolCreator({ onSessionStart }: ProtocolCreatorProps) {
  const { showToast } = useToast()
  const [intent, setIntent] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const charCount = intent.trim().length
  const isTooShort = charCount < 10

  const handleSelectTemplate = (prompt: string, label: string) => {
    setSelectedTemplate(label)
    setIntent(prompt)
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
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
      })

      showToast('Protocol drafting initialized', 'success')
      onSessionStart({
        sessionId: response.data.session_id,
        status: response.data.status,
        intent: activeIntent,
      })
    } catch (err: any) {
      let errorMessage = 'Failed to initialize protocol generation'
      if (err.response) {
        errorMessage =
          err.response.data?.detail ||
          err.response.data?.message ||
          `Server error: ${err.response.status}`
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

  return (
    <motion.div
      layoutId="intent"
      className="bg-white border border-[#E8E4DA] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#EBF3EE] text-[#244F3B]">
            <Bookmark className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#18221E] font-sans">
              Create a clinical protocol
            </h2>
            <p className="text-xs text-[#55635C]">
              AI drafts, screens for safety, critiques empathy, and halts for your review.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label
            htmlFor="intent-input"
            className="block text-xs font-semibold text-[#18221E] mb-1.5"
          >
            Clinical Goal & Context
          </label>
          <div className="relative">
            <textarea
              id="intent-input"
              ref={textareaRef}
              value={intent}
              onChange={(e) => {
                setIntent(e.target.value)
                if (selectedTemplate) setSelectedTemplate(null)
              }}
              placeholder="e.g. Design a 4-step cognitive reframing exercise for catastrophizing and work-related panic..."
              rows={3}
              disabled={loading}
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#E8E4DA] rounded-xl text-xs sm:text-sm text-[#18221E] placeholder-[#88978F] focus:bg-white focus:outline-none focus:border-[#244F3B] focus:ring-1 focus:ring-[#244F3B] transition-all resize-none leading-relaxed"
            />
            {/* Live Character Count */}
            <div className="absolute right-3 bottom-2 text-[10px] font-mono text-[#55635C]">
              {charCount} / 10+ chars
            </div>
          </div>
        </div>

        {/* Template Quick-Select Chips */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#55635C] mb-2 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-[#244F3B]" />
            <span>Try an evidence-based template:</span>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {TEMPLATES.map((tmpl) => {
              const isSelected = selectedTemplate === tmpl.label
              return (
                <button
                  key={tmpl.label}
                  type="button"
                  onClick={() => handleSelectTemplate(tmpl.prompt, tmpl.label)}
                  disabled={loading}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    isSelected
                      ? 'bg-[#244F3B] text-white border-[#244F3B] shadow-2xs'
                      : 'bg-[#FAF8F5] hover:bg-[#F2EFE8] text-[#55635C] hover:text-[#18221E] border-[#E8E4DA]'
                  }`}
                >
                  {tmpl.label}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
            <span className="font-semibold">Error: </span>
            <span>{error}</span>
          </div>
        )}

        {/* Bottom Bar: Helper Hint (shown only below minimum) & Submit Button */}
        <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-[#F0ECE3]">
          <div className="text-xs text-[#55635C] flex items-center gap-1.5 min-h-[20px]">
            {isTooShort && (
              <>
                <HelpCircle className="w-3.5 h-3.5 text-[#55635C]" />
                <span>Describe the exercise (min 10 characters)</span>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || isTooShort}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold rounded-xl transition-all shadow-sm ${
              loading || isTooShort
                ? 'bg-[#D8D2C4] text-[#4A453A] cursor-not-allowed border border-[#C5BFB0]'
                : 'bg-[#244F3B] hover:bg-[#1B3D2E] text-white shadow-md hover:shadow-lg active:scale-[0.99] cursor-pointer'
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Starting…</span>
              </>
            ) : (
              <>
                <span>Create protocol</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  )
}