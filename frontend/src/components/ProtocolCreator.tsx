import { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import axios from 'axios'
import API_BASE_URL from '../config'

interface ProtocolCreatorProps {
  onSessionStart: (session: { sessionId: string; status: string }) => void
}

export default function ProtocolCreator({ onSessionStart }: ProtocolCreatorProps) {
  const [intent, setIntent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('Form submitted!', { intent: intent.trim() })
    
    if (!intent.trim()) {
      console.log('Intent is empty, returning')
      return
    }

    setLoading(true)
    setError(null)
    console.log('Making API request to backend /api/protocols/create...')

    try {
      console.log('Axios POST request starting to:', `${API_BASE_URL}/api/protocols/create`)
      const response = await axios.post(`${API_BASE_URL}/api/protocols/create`, {
        intent: intent.trim(),
      })
      console.log('API response received:', response.data)

      console.log('Calling onSessionStart with:', {
        sessionId: response.data.session_id,
        status: response.data.status,
      })
      
      onSessionStart({
        sessionId: response.data.session_id,
        status: response.data.status,
      })
      
      setIntent('') // Clear input
      console.log('Protocol creation successful!')
    } catch (err: any) {
      console.error('Error creating protocol:', err)
      console.error('Error details:', {
        message: err.message,
        response: err.response,
        status: err.response?.status,
        data: err.response?.data,
        request: err.config
      })
      
      let errorMessage = 'Failed to create protocol'
      if (err.response) {
        // Server responded with error
        errorMessage = err.response.data?.detail || err.response.data?.message || `Server error: ${err.response.status}`
      } else if (err.request) {
        // Request was made but no response received
        errorMessage = `No response from server. Is the backend running on ${API_BASE_URL}?`
      } else {
        // Error setting up request
        errorMessage = `Request error: ${err.message}`
      }
      
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="intent" className="block text-sm font-medium text-slate-300 mb-2">
          Describe the CBT exercise you want to create
        </label>
        <textarea
          id="intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g., Create an exposure hierarchy for agoraphobia"
          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          rows={4}
          disabled={loading}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !intent.trim()}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Creating Protocol...
          </>
        ) : (
          <>
            <Send className="w-5 h-5" />
            Create Protocol
          </>
        )}
      </button>
    </form>
  )
}