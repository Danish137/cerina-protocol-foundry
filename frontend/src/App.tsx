import { useState } from 'react'
import ProtocolCreator from './components/ProtocolCreator'
import ProtocolViewer from './components/ProtocolViewer'
import AgentActivityFeed from './components/AgentActivityFeed'
import { Activity, FileText, Sparkles } from 'lucide-react'

interface ProtocolSession {
  sessionId: string
  status: string
  currentDraft?: string
  safetyScore?: number
  empathyScore?: number
  clinicalScore?: number
}

function App() {
  const [activeSession, setActiveSession] = useState<ProtocolSession | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-8 h-8 text-primary-500" />
            <h1 className="text-4xl font-bold text-white">Cerina Protocol Foundry</h1>
          </div>
          <p className="text-slate-300 text-lg">
            Autonomous multi-agent system for designing CBT exercises
          </p>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Protocol Creator */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg p-6 border border-slate-700">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold text-white">Create CBT Protocol</h2>
              </div>
              <ProtocolCreator 
                onSessionStart={(session) => {
                  setActiveSession(session)
                  setShowViewer(true)
                }}
              />
            </div>

            {/* Protocol Viewer */}
            {showViewer && activeSession && (
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg p-6 border border-slate-700">
                <ProtocolViewer 
                  sessionId={activeSession.sessionId}
                  onClose={() => setShowViewer(false)}
                />
              </div>
            )}
          </div>

          {/* Right: Agent Activity Feed */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg p-6 border border-slate-700 sticky top-4">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-primary-400" />
                <h2 className="text-xl font-semibold text-white">Agent Activity</h2>
              </div>
              <AgentActivityFeed sessionId={activeSession?.sessionId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

