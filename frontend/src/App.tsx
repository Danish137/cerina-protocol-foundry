import { useState, useEffect } from 'react'
import ProtocolCreator from './components/ProtocolCreator'
import ProtocolViewer, { ProtocolState } from './components/ProtocolViewer'
import AgentActivityFeed from './components/AgentActivityFeed'
import { Activity, ShieldCheck, ExternalLink, FileText, MessageSquare, UserCheck, Users, Check } from 'lucide-react'
import API_BASE_URL from './config'

interface ProtocolSession {
  sessionId: string
  status: string
  intent?: string
  currentDraft?: string
  safetyScore?: number
  empathyScore?: number
  clinicalScore?: number
  activeAgent?: string
  halted?: boolean
  humanApproved?: boolean
}

type StepState = 'completed' | 'current' | 'upcoming'

interface StepConfig {
  number: number
  title: string
  subtitle: string
  state: StepState
}

function getWorkflowSteps(activeSession: ProtocolSession | null): StepConfig[] {
  if (!activeSession || !activeSession.sessionId) {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'current' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'upcoming' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'upcoming' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'upcoming' },
    ]
  }

  const status = (activeSession.status || '').toLowerCase()
  const agent = activeSession.activeAgent || ''
  const isHalted = activeSession.halted || status === 'awaiting_approval' || status === 'ready_for_review' || status === 'awaiting_review'

  // Stage 5: Completed
  if (status === 'completed') {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'completed' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'completed' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'completed' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'completed' },
    ]
  }

  // Stage 5: Finalizing (approved and completing)
  if (status === 'approved' || activeSession.humanApproved) {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'completed' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'completed' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'completed' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'current' },
    ]
  }

  // Stage 4: Human review checkpoint
  if (isHalted) {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'completed' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'completed' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'current' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'upcoming' },
    ]
  }

  // Stage 3: Specialist review
  if (agent === 'SafetyGuardian' || agent === 'ClinicalCritic' || status === 'reviewing' || status === 'critiquing' || status === 'deciding') {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'completed' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'current' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'upcoming' },
    ]
  }

  // Stage 2: Clinical drafting
  if (agent === 'Drafter' || status === 'drafting' || status === 'initializing' || status === 'working' || status === 'loading') {
    return [
      { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
      { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'current' },
      { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'upcoming' },
      { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
      { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'upcoming' },
    ]
  }

  // Default fallback when session exists: Step 1 completed, Step 2 current
  return [
    { number: 1, title: 'User intent', subtitle: 'Clinical goal & context', state: 'completed' },
    { number: 2, title: 'Clinical drafting', subtitle: 'Structured exercise', state: 'current' },
    { number: 3, title: 'Specialist review', subtitle: 'Safety, clinical & tone', state: 'upcoming' },
    { number: 4, title: 'Human review', subtitle: 'Edit & approve', state: 'upcoming' },
    { number: 5, title: 'Final protocol', subtitle: 'Download & use', state: 'upcoming' },
  ]
}

// Subtle Botanical Branch SVG to match the reference illustration
function BotanicalIllustration() {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
      {/* Organic Watercolor Leaf Branch */}
      <svg
        viewBox="0 0 320 180"
        className="w-full max-w-[280px] h-auto text-[#2D5A43] drop-shadow-sm opacity-90 transition-transform duration-700 hover:scale-105"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Soft Background Warm Glow */}
        <ellipse cx="160" cy="90" rx="130" ry="70" fill="url(#botanicalGlow)" opacity="0.6" />
        
        {/* Main Stem */}
        <path
          d="M40 140 C 90 125, 160 95, 270 40"
          stroke="#405849"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Branch 1 */}
        <path d="M100 120 C 120 100, 140 70, 150 50" stroke="#4D6756" strokeWidth="1.8" strokeLinecap="round" />
        {/* Branch 2 */}
        <path d="M170 90 C 195 75, 215 55, 225 35" stroke="#4D6756" strokeWidth="1.8" strokeLinecap="round" />

        {/* Leaves */}
        {/* Leaf Top */}
        <path
          d="M270 40 C 290 30, 295 15, 275 25 C 255 35, 260 40, 270 40 Z"
          fill="url(#leafGradient1)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 2 */}
        <path
          d="M230 60 C 255 50, 265 30, 245 42 C 225 54, 222 58, 230 60 Z"
          fill="url(#leafGradient2)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 3 */}
        <path
          d="M195 80 C 220 70, 228 50, 208 62 C 188 74, 190 78, 195 80 Z"
          fill="url(#leafGradient1)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 4 (Left) */}
        <path
          d="M150 50 C 145 25, 125 25, 135 45 C 145 60, 148 55, 150 50 Z"
          fill="url(#leafGradient3)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 5 (Left Middle) */}
        <path
          d="M115 85 C 105 60, 85 65, 100 80 C 112 92, 114 88, 115 85 Z"
          fill="url(#leafGradient2)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 6 (Lower) */}
        <path
          d="M140 105 C 160 115, 175 135, 155 125 C 135 115, 135 110, 140 105 Z"
          fill="url(#leafGradient3)"
          stroke="#385442"
          strokeWidth="0.8"
        />
        {/* Leaf 7 (Bottom Left) */}
        <path
          d="M80 130 C 70 110, 50 115, 65 128 C 75 138, 78 133, 80 130 Z"
          fill="url(#leafGradient1)"
          stroke="#385442"
          strokeWidth="0.8"
        />

        <defs>
          <radialGradient id="botanicalGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E2EBE5" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#FAF8F5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="leafGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#688B74" />
            <stop offset="100%" stopColor="#325A42" />
          </linearGradient>
          <linearGradient id="leafGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7E9F8A" />
            <stop offset="100%" stopColor="#3D684E" />
          </linearGradient>
          <linearGradient id="leafGradient3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#557C63" />
            <stop offset="100%" stopColor="#254A34" />
          </linearGradient>
        </defs>
      </svg>

      {/* Elegant Italic Script Callout */}
      <div className="mt-1 text-right w-full pr-4">
        <p className="font-script text-2xl sm:text-3xl text-[#53655C] tracking-wide -rotate-2 select-none">
          Better tools for a calmer tomorrow.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [activeSession, setActiveSession] = useState<ProtocolSession | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  // Restore previous active session on reload if exists
  useEffect(() => {
    const savedSessionId = localStorage.getItem('cerina_active_session_id')
    if (savedSessionId) {
      setActiveSession({
        sessionId: savedSessionId,
        status: 'loading',
      })
      setShowViewer(true)

      fetch(`${API_BASE_URL}/api/protocols/${savedSessionId}/state`)
        .then((res) => res.json())
        .then((data) => {
          if (data.state) {
            setActiveSession({
              sessionId: savedSessionId,
              status: data.state.status || 'drafting',
              intent: data.state.user_intent,
              currentDraft: data.state.current_draft,
              safetyScore: data.state.safety_score,
              empathyScore: data.state.empathy_score,
              clinicalScore: data.state.clinical_score,
              activeAgent: data.state.active_agent,
              halted: data.state.halted,
              humanApproved: data.state.human_approved,
            })
          }
        })
        .catch((err) => {
          console.warn('Could not restore session on load:', err)
        })
    }
  }, [])

  const handleSessionStart = (session: { sessionId: string; status: string; intent?: string }) => {
    localStorage.setItem('cerina_active_session_id', session.sessionId)
    setActiveSession({
      sessionId: session.sessionId,
      status: session.status,
      intent: session.intent,
    })
    setShowViewer(true)
  }

  const handleStateChange = (newState: ProtocolState) => {
    setActiveSession((prev) => {
      if (!prev) return null
      return {
        ...prev,
        status: newState.status,
        intent: newState.user_intent || prev.intent,
        currentDraft: newState.current_draft || prev.currentDraft,
        safetyScore: newState.safety_score ?? prev.safetyScore,
        empathyScore: newState.empathy_score ?? prev.empathyScore,
        clinicalScore: newState.clinical_score ?? prev.clinicalScore,
        activeAgent: newState.active_agent ?? prev.activeAgent,
        halted: newState.halted ?? prev.halted,
        humanApproved: newState.human_approved ?? prev.humanApproved,
      }
    })
  }

  const steps = getWorkflowSteps(activeSession)
  const isAwaitingApproval = steps[3].state === 'current'

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#18221E] flex flex-col">
      {/* Top Header Bar */}
      <header className="border-b border-[#E8E4DA] bg-[#FAF8F5]/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center gap-2.5">
            {/* Botanical Icon */}
            <div className="p-1 rounded-md text-[#244F3B]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C6.5 2 2 6.5 2 12c0 3.5 2 6.5 5 8 .5-4 3.5-7 7-7 3.5 0 6.5 3 7 7 3-1.5 5-4.5 5-8 0-5.5-4.5-10-10-10z" fill="#244F3B" stroke="none" opacity="0.9" />
                <path d="M12 22V12" stroke="#FAF8F5" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-serif text-xl font-bold tracking-tight text-[#18221E]">
                CERINA
              </span>
              <span className="text-[#C8C2B4] font-light">|</span>
              <span className="text-xs font-sans text-[#7E8F87] font-medium tracking-normal">
                Protocol Foundry
              </span>
            </div>
          </div>

          {/* Right Header Navigation */}
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/Danish137/cerina-protocol-foundry/blob/main/mcp_server/TEST_MCP.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-[#E8E4DA] bg-white hover:bg-[#F5F2EC] text-[#18221E] transition-colors shadow-xs"
              title="Model Context Protocol integration documentation"
            >
              <span className="font-mono text-[11px]">MCP</span>
              <ExternalLink className="w-3 h-3 text-[#7E8F87]" />
            </a>

            {/* Profile Avatar Badge */}
            <div
              className="w-7 h-7 rounded-full bg-[#244F3B] text-white flex items-center justify-center text-xs font-semibold shadow-xs"
              title="Clinical Reviewer Session"
            >
              DA
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full space-y-7">
        {/* Hero Section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pb-2">
          {/* Hero Left: Product Introduction */}
          <div className="md:col-span-7 space-y-3">
            <div className="text-[11px] font-mono tracking-wider font-semibold text-[#244F3B] uppercase">
              MENTAL HEALTH, REAL PROGRESS
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#18221E] font-normal leading-[1.2] tracking-tight">
              Design structured<br className="hidden sm:inline" />
              CBT exercises, with AI that thinks like a clinical team.
            </h1>
            <p className="text-xs sm:text-sm text-[#55635C] leading-relaxed max-w-lg pt-1">
              Describe the exercise you want to create. Cerina drafts a protocol, reviews it through specialized agents, and pauses for your approval before finalization.
            </p>
          </div>

          {/* Hero Right: Botanical Illustration & Quote */}
          <div className="md:col-span-5 flex items-center justify-center">
            <BotanicalIllustration />
          </div>
        </div>

        {/* Dynamic State-Aware Horizontal Workflow Stepper */}
        <div className="bg-white border border-[#E8E4DA] rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-2 items-center">
            {steps.map((step) => {
              const isCompleted = step.state === 'completed'
              const isCurrent = step.state === 'current'
              const isHumanReviewCurrent = isCurrent && step.number === 4

              return (
                <div key={step.number} className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                      isCompleted
                        ? 'bg-[#244F3B] text-white'
                        : isHumanReviewCurrent
                        ? 'bg-[#D4882C] text-white ring-4 ring-[#F4DEC2]'
                        : isCurrent
                        ? 'bg-[#244F3B] text-white ring-4 ring-[#D1E2D7]'
                        : 'bg-[#FAF8F5] text-[#88978F] border border-[#E8E4DA]'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : (
                      <span>{step.number}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`text-xs leading-tight ${
                        isHumanReviewCurrent
                          ? 'font-bold text-[#8C5921]'
                          : isCurrent
                          ? 'font-bold text-[#18221E]'
                          : isCompleted
                          ? 'font-semibold text-[#18221E]'
                          : 'font-medium text-[#88978F]'
                      }`}
                    >
                      {step.title}
                    </p>
                    <p
                      className={`text-[10.5px] truncate ${
                        isHumanReviewCurrent
                          ? 'text-[#A6753B]'
                          : isCurrent
                          ? 'text-[#55635C]'
                          : isCompleted
                          ? 'text-[#7E8F87]'
                          : 'text-[#A4B3AB]'
                      }`}
                    >
                      {step.subtitle}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 2-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          {/* Left Column: Creator & Protocol Viewer (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <ProtocolCreator
              onSessionStart={handleSessionStart}
            />

            {showViewer && activeSession && (
              <ProtocolViewer
                sessionId={activeSession.sessionId}
                onStateChange={handleStateChange}
              />
            )}
          </div>

          {/* Right Column: AI Review Team & Activity Trace (5 cols) */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
            {/* The AI Review Team Card */}
            <div className="bg-white border border-[#E8E4DA] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#F0ECE3]">
                <div className="p-1 rounded bg-[#EBF3EE] text-[#244F3B]">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-[#18221E] font-sans">
                  The AI Review Team
                </h3>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Drafter */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] text-[#244F3B] shrink-0 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-[#18221E] text-xs">Clinical Drafter</span>
                    <p className="text-[11px] text-[#55635C] leading-snug mt-0.5">
                      Structures evidence-based CBT exercises.
                    </p>
                  </div>
                </div>

                {/* Safety Guardian */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] text-[#244F3B] shrink-0 mt-0.5">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-[#18221E] text-xs">Safety Guardian</span>
                    <p className="text-[11px] text-[#55635C] leading-snug mt-0.5">
                      Screens for medical advice, contraindications and self-harm risk.
                    </p>
                  </div>
                </div>

                {/* Clinical Critic */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] text-[#2B6CB0] shrink-0 mt-0.5">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-[#18221E] text-xs">Clinical Critic</span>
                    <p className="text-[11px] text-[#55635C] leading-snug mt-0.5">
                      Evaluates tone, empathy, warmth and CBT alignment.
                    </p>
                  </div>
                </div>

                {/* Human Checkpoint */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#FBF5EB] border border-[#EEDDC3] text-[#8C5921] shrink-0 mt-0.5">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-[#8C5921] text-xs">Human Checkpoint</span>
                    <p className="text-[11px] text-[#734A1B] leading-snug mt-0.5">
                      Mandatory pause for your review and approval.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Activity Trace Card */}
            <div className="bg-white border border-[#E8E4DA] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="p-4 bg-[#FAF8F5] border-b border-[#E8E4DA] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-[#EBF3EE] text-[#244F3B]">
                    <Activity className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#18221E] font-sans">
                    Workflow activity trace
                  </h3>
                </div>
              </div>

              <AgentActivityFeed
                sessionId={activeSession?.sessionId}
                isAwaitingApproval={isAwaitingApproval}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Clean Minimalist Footer */}
      <footer className="border-t border-[#E8E4DA] py-6 mt-12 text-xs text-[#7E8F87]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="font-serif text-[#18221E]">Cerina Protocol Foundry</span>
          <span>Collaborative AI Review & Human-in-the-Loop CBT Engineering</span>
        </div>
      </footer>
    </div>
  )
}

