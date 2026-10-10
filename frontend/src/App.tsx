import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { LayoutGroup, motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import axios from 'axios'
import API_BASE_URL from './config'
import Header from './components/Header'
import ProtocolCreator from './components/ProtocolCreator'
import IntentSummary from './components/IntentSummary'
import AgentRoster from './components/AgentRoster'
import ReviewSummary from './components/ReviewSummary'
import DocumentViewer from './components/DocumentViewer'
import ActionPanel from './components/ActionPanel'
import { ToastProvider, useToast } from './components/Toast'
import { appReducer, derivePhase, AppState } from './stateReducer'
import { ReviewerSuggestion } from './types'
import { normalizeAgentId, getAgent } from './agents'
import { exportClinicalPdf } from './pdfGenerator'
import { Activity, FileText } from 'lucide-react'
import { LogEntry } from './components/ActivityLogSheet'

const initialAppState: AppState = {
  protocolState: null,
  activeSessionId: null,
  uiMode: 'idle',
  editedDraft: '',
  initialDraftBeforeEdit: '',
  validationStatus: 'none',
  lastValidatedHash: null,
  approvalTime: undefined,
  addressedSuggestions: {},
  dismissedSuggestions: {},
  hasOptimisticStart: false,
}

function AppContent() {
  const { showToast } = useToast()
  const shouldReduceMotion = useReducedMotion()

  // Pure Reducer + Derived Phase (Section 3)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const phase = derivePhase(state.protocolState, state.uiMode)

  // Mobile navigation tab (<1024px)
  const [mobileTab, setMobileTab] = useState<'document' | 'review'>('document')

  // Timers and fallback polling refs
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)
  const timerRef = useRef<number | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const lastSseEventTime = useRef<number>(Date.now())
  const pollingBackoffMs = useRef<number>(2000)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Document Heading Scroll target
  const handleHeadingClick = (headingText: string) => {
    const headings = document.querySelectorAll('article h1, article h2, article h3')
    for (const el of headings) {
      if (el.textContent?.includes(headingText)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        break
      }
    }
  }

  // Restore session from localStorage on initial mount
  useEffect(() => {
    const savedId = localStorage.getItem('cerina_active_session_id')
    if (savedId) {
      // Restore addressed/dismissed
      try {
        const addr = sessionStorage.getItem(`cerina_addressed_${savedId}`)
        const dism = sessionStorage.getItem(`cerina_dismissed_${savedId}`)
        if (addr) state.addressedSuggestions = JSON.parse(addr)
        if (dism) state.dismissedSuggestions = JSON.parse(dism)
      } catch (_) {}

      fetch(`${API_BASE_URL}/api/protocols/${savedId}/state`)
        .then((res) => res.json())
        .then((data) => {
          if (data.state) {
            dispatch({ type: 'APPLY_SNAPSHOT', state: data.state })
          }
        })
        .catch((err) => {
          console.warn('Could not restore session:', err)
        })
    }
  }, [])

  // Browser tab title update based on phase
  useEffect(() => {
    if (phase === 'review') {
      document.title = '● Review needed — Cerina'
    } else if (phase === 'editing') {
      document.title = 'Editing — Cerina'
    } else if (phase === 'approved') {
      document.title = 'Approved ✓ — Cerina Protocol Foundry'
    } else if (phase === 'generating') {
      document.title = 'Drafting… — Cerina'
    } else {
      document.title = 'Cerina Protocol Foundry — CBT Protocol Design'
    }
  }, [phase])

  // Elapsed generation timer
  useEffect(() => {
    if (phase === 'generating') {
      setElapsedSeconds(0)
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [phase])

  // Word diff calculation
  const { wordsAdded, wordsRemoved } = useMemo(() => {
    if (phase !== 'editing' || !state.initialDraftBeforeEdit) return { wordsAdded: 0, wordsRemoved: 0 }
    const origWords = state.initialDraftBeforeEdit.trim().split(/\s+/).filter(Boolean)
    const newWords = state.editedDraft.trim().split(/\s+/).filter(Boolean)
    const added = Math.max(0, newWords.length - origWords.length)
    const removed = Math.max(0, origWords.length - newWords.length)
    return { wordsAdded: added, wordsRemoved: removed }
  }, [phase, state.initialDraftBeforeEdit, state.editedDraft])

  // Suggestions conversion with normalized severity (Section 4 & 5)
  const suggestions: ReviewerSuggestion[] = useMemo(() => {
    const notes = state.protocolState?.agent_notes || []
    return notes
      .filter((n) => {
        const msg = n.message || n.note || ''
        return msg.length > 5
      })
      .map((n, idx) => {
        const agentId = normalizeAgentId(n.agent_id || n.agent_name)
        const agentCfg = getAgent(agentId)
        const rawMsg = (n.message || n.note || '').replace(/^IMPROVEMENT NEEDED:\s*/i, '').trim()
        const id = `sug_${idx}_${rawMsg.slice(0, 16)}`

        // Severity: Default "suggestion", "warning" only if score within 5pts of threshold, "critical" for safety
        let sev: 'suggestion' | 'warning' | 'critical' = 'suggestion'
        if (
          agentId === 'safety_guardian' &&
          ((state.protocolState?.safety_score ?? 1) < 0.8 ||
            rawMsg.toLowerCase().includes('contraindication') ||
            rawMsg.toLowerCase().includes('critical'))
        ) {
          sev = 'critical'
        } else if (
          (state.protocolState?.safety_score !== undefined && state.protocolState.safety_score < 0.85) ||
          (state.protocolState?.empathy_score !== undefined && state.protocolState.empathy_score < 0.75) ||
          (state.protocolState?.clinical_score !== undefined && state.protocolState.clinical_score < 0.75)
        ) {
          sev = 'warning'
        }

        return {
          id,
          agentId,
          agentLabel: agentCfg.label,
          message: rawMsg,
          severity: sev,
          createdAt: n.created_at || n.timestamp,
          isAddressed: Boolean(state.addressedSuggestions[id]),
          isDismissed: Boolean(state.dismissedSuggestions[id]),
        }
      })
  }, [state.protocolState, state.addressedSuggestions, state.dismissedSuggestions])

  // Activity logs newest-first (Section 1 & 4)
  const activityLogs: LogEntry[] = useMemo(() => {
    const notes = state.protocolState?.agent_notes || []
    return notes
      .map((n, idx) => {
        const agentId = normalizeAgentId(n.agent_id || n.agent_name)
        const agentCfg = getAgent(agentId)
        const cleanMsg = (n.message || n.note || '').replace(/^IMPROVEMENT NEEDED:\s*/i, '').trim()
        const prio: 'info' | 'warning' | 'critical' =
          n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'
        return {
          id: `log_${idx}`,
          agent: agentCfg.label,
          action: cleanMsg,
          timestamp: n.created_at || n.timestamp || 'Just now',
          priority: prio,
        }
      })
      .reverse()
  }, [state.protocolState?.agent_notes])

  // Fallback Polling Function (Section 3)
  const pollServerState = useCallback(async () => {
    const sid = state.activeSessionId || state.protocolState?.session_id
    if (!sid) return

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    try {
      const res = await axios.get(`${API_BASE_URL}/api/protocols/${sid}/state`, {
        signal: abortControllerRef.current.signal,
      })
      if (res.data?.state) {
        lastSseEventTime.current = Date.now()
        dispatch({ type: 'APPLY_SNAPSHOT', state: res.data.state })
      }
    } catch (err: any) {
      if (axios.isCancel(err)) return
      console.warn('Fallback poll error:', err.message)
    }
  }, [state.activeSessionId, state.protocolState?.session_id])

  // SSE Stream Management & Silence Detection
  useEffect(() => {
    const sid = state.activeSessionId || state.protocolState?.session_id
    if (!sid || phase === 'approved' || phase === 'idle') return

    const sseUrl = `${API_BASE_URL}/api/protocols/${sid}/stream`
    const es = new EventSource(sseUrl)
    sseRef.current = es
    lastSseEventTime.current = Date.now()

    const handleSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.state) {
          lastSseEventTime.current = Date.now()
          pollingBackoffMs.current = 2000
          dispatch({ type: 'APPLY_SNAPSHOT', state: data.state })
        }
      } catch (err) {
        console.error('Error handling SSE event:', err)
      }
    }

    es.addEventListener('state_update', handleSnapshot)
    es.addEventListener('halted', handleSnapshot)
    es.addEventListener('complete', handleSnapshot)

    es.onerror = () => {
      es.close()
      // Immediately schedule fallback poll on error
      pollServerState()
    }

    // 10s Silence Checker & Backoff Fallback (Section 3)
    const silenceInterval = window.setInterval(() => {
      const elapsedSilence = Date.now() - lastSseEventTime.current
      if (elapsedSilence >= 10000 && phase === 'generating') {
        pollServerState()
        pollingBackoffMs.current = Math.min(8000, pollingBackoffMs.current * 2)
      }
    }, pollingBackoffMs.current)

    // Visibility change resync (Section 3)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollServerState()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      es.close()
      clearInterval(silenceInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [state.activeSessionId, state.protocolState?.session_id, phase, pollServerState])

  // Session start handler with Optimistic Transition (Section 2)
  const handleSessionStart = async ({ sessionId, intent }: { sessionId: string; status: string; intent: string }) => {
    localStorage.setItem('cerina_active_session_id', sessionId)
    dispatch({ type: 'START_CREATE', sessionId, intent })

    try {
      // Trigger initial poll immediately
      const res = await axios.get(`${API_BASE_URL}/api/protocols/${sessionId}/state`)
      if (res.data?.state) {
        dispatch({ type: 'APPLY_SNAPSHOT', state: res.data.state })
      }
    } catch (err: any) {
      console.warn('Initial session sync failed, fallback polling will retry:', err)
    }
  }

  // Edit Handlers
  const handleStartEditing = () => {
    dispatch({ type: 'ENTER_EDIT' })
    showToast('Entered clinician edit mode', 'info')
  }

  const handleDiscardEdits = () => {
    dispatch({ type: 'DISCARD_EDIT' })
    showToast('Unsaved edits discarded', 'info')
  }

  const handleDraftChange = (newText: string) => {
    dispatch({ type: 'UPDATE_EDITED_DRAFT', draft: newText })
  }

  // Revalidate only (Section 7)
  const handleRevalidateOnly = async () => {
    const sid = state.activeSessionId || state.protocolState?.session_id
    if (!sid) return
    dispatch({ type: 'START_VALIDATING' })

    try {
      const response = await axios.post(`${API_BASE_URL}/api/protocols/${sid}/revalidate`, {
        draft: state.editedDraft,
      })
      const data = response.data
      const passes = data.safety_score >= 0.8 && data.empathy_score >= 0.7 && data.clinical_score >= 0.7

      if (passes) {
        dispatch({
          type: 'VALIDATION_SUCCESS',
          hash: data.validated_hash || 'OK',
          safetyScore: data.safety_score,
          empathyScore: data.empathy_score,
          clinicalScore: data.clinical_score,
        })
        showToast('Safety check passed for updated draft', 'success')
      } else {
        dispatch({ type: 'VALIDATION_FAILED' })
        const failedMetrics: string[] = []
        if (data.safety_score < 0.8) failedMetrics.push('Safety')
        if (data.empathy_score < 0.7) failedMetrics.push('Empathy')
        if (data.clinical_score < 0.7) failedMetrics.push('Clinical Fidelity')
        showToast(`Validation below required threshold in: ${failedMetrics.join(', ')}`, 'error')
      }
    } catch (err: any) {
      dispatch({ type: 'VALIDATION_FAILED' })
      const friendlyMsg = err.response?.data?.message || err.response?.data?.detail || 'Validation service temporarily unavailable'
      showToast(friendlyMsg, 'error')
    }
  }

  // Approve handlers (Section 7)
  const handleApprove = async () => {
    const sid = state.activeSessionId || state.protocolState?.session_id
    if (!sid) return
    dispatch({ type: 'START_APPROVING' })

    try {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      await axios.post(`${API_BASE_URL}/api/protocols/${sid}/approve`, {
        approved_by: 'Clinical Supervisor',
        edited: false,
        validated_hash: state.lastValidatedHash || 'BASELINE',
      })

      dispatch({ type: 'APPROVE_SUCCESS', time: now })
      showToast('Protocol approved & locked', 'success')
      pollServerState()
    } catch (err: any) {
      dispatch({ type: 'APPROVE_FAILED' })
      const friendlyMsg = err.response?.data?.message || err.response?.data?.detail || 'Approval request failed'
      showToast(friendlyMsg, 'error')
    }
  }

  const handleSaveEditsAndApprove = async () => {
    const sid = state.activeSessionId || state.protocolState?.session_id
    if (!sid) return

    // If edits are stale or unvalidated, revalidate first per Section 7
    if (state.validationStatus === 'stale' || state.validationStatus === 'none') {
      dispatch({ type: 'START_VALIDATING' })
      try {
        const valRes = await axios.post(`${API_BASE_URL}/api/protocols/${sid}/revalidate`, {
          draft: state.editedDraft,
        })
        const valData = valRes.data
        const passes = valData.safety_score >= 0.8 && valData.empathy_score >= 0.7 && valData.clinical_score >= 0.7

        if (!passes) {
          dispatch({ type: 'VALIDATION_FAILED' })
          const failedMetrics: string[] = []
          if (valData.safety_score < 0.8) failedMetrics.push('Safety')
          if (valData.empathy_score < 0.7) failedMetrics.push('Empathy')
          if (valData.clinical_score < 0.7) failedMetrics.push('Clinical Fidelity')
          showToast(`Cannot approve: ${failedMetrics.join(', ')} failed validation`, 'error')
          return
        }

        dispatch({
          type: 'VALIDATION_SUCCESS',
          hash: valData.validated_hash || 'OK',
          safetyScore: valData.safety_score,
          empathyScore: valData.empathy_score,
          clinicalScore: valData.clinical_score,
        })
      } catch (err: any) {
        dispatch({ type: 'VALIDATION_FAILED' })
        const friendlyMsg = err.response?.data?.message || err.response?.data?.detail || 'Revalidation failed'
        showToast(friendlyMsg, 'error')
        return
      }
    }

    dispatch({ type: 'START_APPROVING' })
    try {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      await axios.post(`${API_BASE_URL}/api/protocols/${sid}/approve`, {
        approved_content: state.editedDraft,
        approved_by: 'Clinical Supervisor',
        edited: true,
        validated_hash: state.lastValidatedHash || 'EDITED-OK',
      })

      dispatch({ type: 'APPROVE_SUCCESS', time: now })
      showToast('Protocol validated and approved with edits', 'success')
      pollServerState()
    } catch (err: any) {
      dispatch({ type: 'APPROVE_FAILED' })
      const friendlyMsg = err.response?.data?.message || err.response?.data?.detail || 'Failed to approve edited protocol'
      showToast(friendlyMsg, 'error')
    }
  }

  // Export PDF with @react-pdf/renderer (Section 8)
  const handleExportPdf = async () => {
    const draftText = state.editedDraft || state.protocolState?.current_draft || ''
    if (!draftText.trim()) {
      showToast('No protocol content available to export', 'error')
      return
    }

    try {
      const filename = await exportClinicalPdf(
        draftText,
        state.protocolState?.approval_audit,
        {
          safety: state.protocolState?.safety_score,
          empathy: state.protocolState?.empathy_score,
          clinical: state.protocolState?.clinical_score,
        }
      )
      showToast(`Saved ${filename}`, 'success')
    } catch (err: any) {
      showToast(`PDF Export error: ${err.message}`, 'error')
    }
  }

  const handleCopyMarkdown = () => {
    const draftText = state.editedDraft || state.protocolState?.current_draft || ''
    navigator.clipboard.writeText(draftText)
    showToast('Protocol markdown copied to clipboard', 'success')
  }

  const handleNewProtocol = () => {
    if (phase === 'editing' && (wordsAdded > 0 || wordsRemoved > 0)) {
      if (!window.confirm('You have unsaved edits. Discard and start a new protocol?')) {
        return
      }
    }
    localStorage.removeItem('cerina_active_session_id')
    dispatch({ type: 'RESET' })
    showToast('Ready for new protocol', 'info')
  }

  const hasDraft = Boolean(state.protocolState?.current_draft || state.editedDraft)
  const isSafetyCriticRunning = phase === 'generating' && hasDraft

  return (
    <LayoutGroup>
      {/* Height Guard: shell min-h-[620px]; below that let body scroll rather than clip controls (Section 1) */}
      <div className="min-h-[620px] h-dvh flex flex-col bg-[#FAF8F5] text-[#18221E] select-none">
        {/* Header Bar */}
        <Header
          phase={phase}
          activeAgent={state.protocolState?.active_agent}
          sessionId={state.activeSessionId || state.protocolState?.session_id}
          onNewProtocol={handleNewProtocol}
        />

        {/* Main Workspace Shell */}
        <main className="flex-1 overflow-hidden max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4 flex flex-col">
          {/* =========================================================================
              PHASE: IDLE (Hero + Compact Form + AI Roster Explainer)
             ========================================================================= */}
          {phase === 'idle' ? (
            <AnimatePresence mode="wait">
              <motion.div
                key="idle-view"
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full flex flex-col justify-center max-w-5xl mx-auto space-y-4 sm:space-y-6"
              >
                {/* Hero Header with Sprig & Plain Copy (Section 10) */}
                <div className="text-center space-y-2 pt-2">
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="w-5 h-5 text-[#244F3B]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M12 2C8 6 4 12 12 22M12 7c-2 1-4 3-4 5m4-7c2 1 4 3 4 5" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs font-semibold text-[#244F3B] tracking-normal font-sans">
                      Clinical-grade Cognitive Behavioral Protocol Design
                    </span>
                  </div>

                  <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-[#18221E] font-medium tracking-tight">
                    Design structured CBT exercises with multidisciplinary AI.
                  </h1>

                  <p className="font-serif italic text-sm text-[#244F3B]/80 max-w-md mx-auto">
                    Evidence-based protocol authoring for clinical excellence
                  </p>

                  <p className="text-xs text-[#55635C] max-w-lg mx-auto">
                    Cerina drafts exercises, verifies clinical contraindications, evaluates therapeutic empathy, and halts for licensed clinician review.
                  </p>
                </div>

                {/* 2-Column Split: Form (layoutId="intent") + Explainer Roster (layoutId="roster") */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                  <div className="md:col-span-7">
                    <ProtocolCreator onSessionStart={handleSessionStart} />
                  </div>

                  <div className="md:col-span-5">
                    <AgentRoster phase="idle" state={null} isExplainer={true} />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            /* =========================================================================
                ACTIVE PHASES: generating | review | editing | approving | approved
                3-Column Shell (Section 1): Exactly ONE vertical scroll surface at >=1024px.
               ========================================================================= */
            <div className="h-full flex flex-col overflow-hidden">
              {/* Mobile Tab Switcher (<1024px) */}
              <div className="lg:hidden flex items-center justify-between pb-2 mb-2 border-b border-[#E8E4DA] shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileTab('document')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                      mobileTab === 'document'
                        ? 'bg-[#244F3B] text-white shadow-2xs'
                        : 'bg-white text-[#55635C] border border-[#E8E4DA]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Protocol Draft</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab('review')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                      mobileTab === 'review'
                        ? 'bg-[#244F3B] text-white shadow-2xs'
                        : 'bg-white text-[#55635C] border border-[#E8E4DA]'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Review & Metrics</span>
                  </button>
                </div>
              </div>

              {/* 3-Column Shell Container */}
              <div className="flex-1 flex gap-5 overflow-hidden">
                {/* =====================================================================
                    1. LEFT RAIL: >=1536px (300px fixed). NEVER SCROLLS.
                    Contains: IntentSummary (layoutId="intent") + AgentRoster (layoutId="roster")
                   ===================================================================== */}
                <div className="hidden 2xl:flex w-[300px] shrink-0 flex-col gap-4 overflow-hidden select-none">
                  <IntentSummary
                    intent={state.protocolState?.user_intent || ''}
                    draftVersion={state.protocolState?.draft_history?.length || 1}
                    maxIterations={state.protocolState?.max_iterations || 5}
                    phase={phase}
                    onNewProtocol={handleNewProtocol}
                  />

                  <AgentRoster
                    phase={phase}
                    state={state.protocolState}
                    onHeadingClick={handleHeadingClick}
                  />
                </div>

                {/* =====================================================================
                    2. CENTER PANE: DocumentViewer (1fr).
                    THE ONLY SCROLLER AT >=1024px.
                    Scroller is on outermost element; margins & padding live inside.
                   ===================================================================== */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.08 }}
                  className={`flex-1 min-w-0 h-full flex flex-col gap-3 overflow-hidden ${
                    mobileTab !== 'document' ? 'hidden lg:flex' : 'flex'
                  }`}
                >
                  {/* On 1024-1535px: show IntentSummary strip at top */}
                  <div className="hidden lg:block 2xl:hidden shrink-0">
                    <IntentSummary
                      intent={state.protocolState?.user_intent || ''}
                      draftVersion={state.protocolState?.draft_history?.length || 1}
                      maxIterations={state.protocolState?.max_iterations || 5}
                      phase={phase}
                      onNewProtocol={handleNewProtocol}
                    />
                  </div>

                  {/* DocumentViewer with Outermost Scroller */}
                  <div className="flex-1 overflow-hidden">
                    <DocumentViewer
                      phase={phase}
                      draft={state.protocolState?.current_draft || ''}
                      editedDraft={state.editedDraft}
                      isSafetyCriticRunning={isSafetyCriticRunning}
                      elapsedSeconds={elapsedSeconds}
                      sessionId={state.activeSessionId || state.protocolState?.session_id}
                      onDraftChange={handleDraftChange}
                      onStartEditing={handleStartEditing}
                      onSaveEditsAndApprove={handleSaveEditsAndApprove}
                      onDiscardEdits={handleDiscardEdits}
                      onExportPdf={handleExportPdf}
                    />
                  </div>
                </motion.div>

                {/* =====================================================================
                    3. RIGHT RAIL: ReviewSummary + flex-1 spacer + Pinned ActionPanel.
                    NEVER SCROLLS AT >=1024px. (Section 1)
                   ===================================================================== */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.12 }}
                  className={`w-full lg:w-[360px] 2xl:w-[380px] shrink-0 h-full flex flex-col overflow-hidden select-none ${
                    mobileTab !== 'review' ? 'hidden lg:flex' : 'flex'
                  }`}
                >
                  {/* ReviewSummary (Auto Height, Compact, No Inner Scroller) */}
                  <div className="shrink-0">
                    <ReviewSummary
                      state={state.protocolState}
                      suggestions={suggestions}
                      activityLogs={activityLogs}
                      onToggleAddressed={(id) => dispatch({ type: 'TOGGLE_ADDRESSED', id })}
                      onDismissSuggestion={(id) => dispatch({ type: 'DISMISS_SUGGESTION', id })}
                    />
                  </div>

                  {/* flex-1 min-h-0 spacer (absorbs vertical slack) */}
                  <div className="flex-1 min-h-0" />

                  {/* Desktop Pinned ActionPanel (shrink-0, border-t, never overlaps) */}
                  <div className="hidden lg:block shrink-0">
                    <ActionPanel
                      phase={phase}
                      validationStatus={state.validationStatus}
                      hasEdits={state.editedDraft !== state.initialDraftBeforeEdit}
                      wordsAdded={wordsAdded}
                      wordsRemoved={wordsRemoved}
                      approvalTime={state.approvalTime}
                      onApprove={handleApprove}
                      onStartEditing={handleStartEditing}
                      onSaveEditsAndApprove={handleSaveEditsAndApprove}
                      onRevalidateOnly={handleRevalidateOnly}
                      onDiscardEdits={handleDiscardEdits}
                      onExportPdf={handleExportPdf}
                      onCopyMarkdown={handleCopyMarkdown}
                      onNewProtocol={handleNewProtocol}
                    />
                  </div>
                </motion.div>
              </div>

              {/* Mobile Sticky ActionPanel (<1024px) */}
              <div className="lg:hidden shrink-0 pt-2 border-t border-[#E8E4DA] bg-[#FAF8F5]">
                <ActionPanel
                  phase={phase}
                  validationStatus={state.validationStatus}
                  hasEdits={state.editedDraft !== state.initialDraftBeforeEdit}
                  wordsAdded={wordsAdded}
                  wordsRemoved={wordsRemoved}
                  approvalTime={state.approvalTime}
                  onApprove={handleApprove}
                  onStartEditing={handleStartEditing}
                  onSaveEditsAndApprove={handleSaveEditsAndApprove}
                  onRevalidateOnly={handleRevalidateOnly}
                  onDiscardEdits={handleDiscardEdits}
                  onExportPdf={handleExportPdf}
                  onCopyMarkdown={handleCopyMarkdown}
                  onNewProtocol={handleNewProtocol}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </LayoutGroup>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}
