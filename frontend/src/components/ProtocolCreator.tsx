import { useState } from 'react'
import { ArrowRight, Loader2, Bookmark, Info } from 'lucide-react'
import axios from 'axios'
import API_BASE_URL from '../config'

interface ProtocolCreatorProps {
  onSessionStart: (session: { sessionId: string; status: string; intent?: string }) => void
}

const TEMPLATES = [
  { label: 'Anxiety (public speaking)', prompt: 'Create a graded exposure hierarchy for someone experiencing anxiety around public speaking.' },
  { label: 'Mild depression', prompt: 'Create a behavioral activation routine and mastery/pleasure schedule for mild depression.' },
  { label: 'Insomnia (sleep hygiene)', prompt: 'Create a stimulus control and sleep hygiene routine for persistent sleep-onset insomnia.' },
  { label: 'Negative thought record', prompt: 'Create a cognitive restructuring 5-column thought record for catastrophizing and negative automatic thoughts.' },
]

export default function ProtocolCreator({ onSessionStart }: ProtocolCreatorProps) {
  const [intent, setIntent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e?: React.FormEvent, promptOverride?: string) => {
    if (e) e.preventDefault()
    const activeIntent = (promptOverride || intent).trim()
    
    if (!activeIntent) return

    setLoading(true)
    setError(null)

    try {
      const response = await axios.post(`${API_BASE_URL}/api/protocols/create`, {
        intent: activeIntent,
      })

      onSessionStart({
        sessionId: response.data.session_id,
        status: response.data.status,
        intent: activeIntent,
      })
      
      setIntent('')
    } catch (err: any) {
      let errorMessage = 'Failed to initialize protocol generation'
      if (err.response) {
        errorMessage = err.response.data?.detail || err.response.data?.message || `Server error: ${err.response.status}`
      } else if (err.request) {
        errorMessage = `No response from server. Is the backend running on ${API_BASE_URL}?`
      } else {
        errorMessage = `Request error: ${err.message}`
      }
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectTemplate = (prompt: string) => {
    setIntent(prompt)
  }

  return (
    <div className="bg-white border border-[#E8E4DA] rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-[#EBF3EE] text-[#244F3B]">
            <Bookmark className="w-4 h-4" />
          </div>
          <h2 className="text-base font-semibold text-[#18221E] font-sans">
            Create a protocol
          </h2>
        </div>
        <span className="text-xs font-mono text-[#88978F]">Step 1 of 5</span>
      </div>

      <p className="text-xs font-medium text-[#55635C] mb-2.5">
        Describe the exercise you want to design
      </p>

      <form onSubmit={(e) => handleSubmit(e)} className="space-y-4">
        <div>
          <textarea
            id="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. Create a graded exposure hierarchy for someone experiencing anxiety around public speaking."
            className="w-full px-4 py-3 bg-[#FAF8F5] border border-[#E8E4DA] rounded-lg text-sm text-[#18221E] placeholder-[#88978F] focus:bg-white focus:outline-none focus:border-[#244F3B] focus:ring-1 focus:ring-[#244F3B] transition-all resize-none leading-relaxed"
            rows={3}
            disabled={loading}
          />
        </div>

        {/* Template Pills */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#55635C] mb-2">
            <Bookmark className="w-3.5 h-3.5 text-[#244F3B]" />
            <span className="font-medium">Try a template</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.label}
                type="button"
                onClick={() => handleSelectTemplate(tmpl.prompt)}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-full bg-[#FAF8F5] hover:bg-[#F2EFE8] text-[#55635C] hover:text-[#18221E] border border-[#E8E4DA] transition-colors"
              >
                {tmpl.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-[#FDF3F3] border border-[#F5C6C6] rounded-lg text-[#9B2C2C] text-xs flex items-start gap-2">
            <span className="font-semibold">Error:</span>
            <span>{error}</span>
          </div>
        )}

        <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-[#F0ECE3]">
          <div className="text-xs text-[#7A8B83] flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#88978F]" />
            <span>Cerina will draft → review → refine → request approval.</span>
          </div>

          <button
            type="submit"
            disabled={loading || !intent.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#244F3B] hover:bg-[#1B3D2E] disabled:bg-[#D8D4C8] disabled:text-[#88978F] disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Initializing...</span>
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
    </div>
  )
}