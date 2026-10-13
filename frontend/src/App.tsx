import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { LayoutGroup, motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import axios from 'axios'
import API_BASE_URL from './config'
import Header from './components/Header'
import ProtocolCreator from './components/ProtocolCreator'
import IntentSummary from './components/IntentSummary'
import AgentPipeline from './components/AgentPipeline'
import LiveAgentFeed from './components/LiveAgentFeed'
import ScoreMeters from './components/ScoreMeters'
import TimelineSheet from './components/TimelineSheet'
import Outline from './components/Outline'
import DocumentViewer from './components/DocumentViewer'
import ActionPanel from './components/ActionPanel'
import CarePanel from './components/CarePanel'
import { ToastProvider, useToast } from './components/Toast'
import { protocolReducer, initialReducerState } from './state/protocolReducer'
import { ProtocolStreamClient } from './services/sseClient'
import {
  saveSession,
  getSession,
  updateSessionStatus,
  getAutoResumeSession
} from './services/sessionStorage'
import { StoredSession, ProtocolEvent } from './types'
import { exportClinicalPdf } from './pdfGenerator'
import { Activity, FileText, CheckCircle2, AlertCircle } from 'lucide-react'

function AppContent() {
  const { showToast } = useToast()
  const shouldReduceMotion = useReducedMotion()

  // Protocol Reducer (B1)
  const [state, dispatch] = useReducer(protocolReducer, initialReducerState)
  const phase = state.phase

  // Edit mode local state
  const [editedDraft, setEditedDraft] = useState<string>('')
  const [initialDraftBeforeEdit, setInitialDraftBeforeEdit] = useState<string>('')
  const [validationStatus, setValidationStatus] = useState<'none' | 'checking' | 'passed' | 'failed' | 'stale'>('none')
  const [lastValidatedHash, setLastValidatedHash] = useState<string | null>(null)
  const [approvalTime, setApprovalTime] = useState<string | undefined>(undefined)
  const [isRevisionRequested, setIsRevisionRequested] = useState<boolean>(false)

  // Sheet & UI view states
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false)
  const [mobileTab, setMobileTab] = useState<'document' | 'review'>('document')
  const [resumeBanner, setResumeBanner] = useState<string | null>(null)
  const [browserMismatchAlert, setBrowserMismatchAlert] = useState<boolean>(false)
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)

  // Stream client & timer refs
  const streamClientRef = useRef<ProtocolStreamClient | null>(null)
  const timerRef = useRef<number | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Sync draft from state into editedDraft when entering edit mode or when new draft arrives
  useEffect(() => {
    if (state.draft && !editedDraft) {
      setEditedDraft(state.draft)
      setInitialDraftBeforeEdit(state.draft)
    }
  }, [state.draft])

  // Word diff calculation for ActionPanel
  const { wordsAdded, wordsRemoved } = useMemo(() => {
    if (phase !== 'editing' || !initialDraftBeforeEdit) return { wordsAdded: 0, wordsRemoved: 0 }
    const origWords = initialDraftBeforeEdit.trim().split(/\s+/).filter(Boolean)
    const newWords = editedDraft.trim().split(/\s+/).filter(Boolean)
    const added = Math.max(0, newWords.length - origWords.length)
    const removed = Math.max(0, origWords.length - newWords.length)
    return { wordsAdded: added, wordsRemoved: removed }
  }, [phase, initialDraftBeforeEdit, editedDraft])

  // Connect SSE Stream with ProtocolStreamClient (B1)
  const connectStream = useCallback((sessionId: string, token: string) => {
    if (streamClientRef.current) {
      streamClientRef.current.stop()
    }

    const client = new ProtocolStreamClient({
      sessionId,
      sessionToken: token,
      onEvent: (event: ProtocolEvent) => {
        dispatch({ type: 'ADD_EVENT', event })

        // Synchronize canonical draft on draft event, Drafter node_end, checkpoint, or run_end (P0-1)
        if ((event.type === 'draft' || (event.type === 'node_end' && event.agent === 'Drafter') || event.type === 'checkpoint' || event.type === 'run_end') && event.data?.draft) {
          dispatch({ type: 'SET_DRAFT', draft: event.data.draft, version: event.draft_version || event.data.version || 1 })
          setEditedDraft(event.data.draft)
          setInitialDraftBeforeEdit(event.data.draft)
        }

        // On checkpoint, update session storage
        if (event.type === 'checkpoint') {
          updateSessionStatus(sessionId, event.data?.status || 'review')
        }

        // On approval, update session storage
        if (event.type === 'approval') {
          updateSessionStatus(sessionId, 'approved')
        }
      },
      onToken: (tok: string) => {
        dispatch({ type: 'APPEND_TOKEN', token: tok })
      },
      onError: (err) => {
        dispatch({ type: 'SET_ERROR', code: err.code, message: err.message, retryable: err.retryable })
        if (err.code === 'QUOTA_EXCEEDED') {
          showToast('Daily demonstration quota reached.', 'error')
        }
      },
      onRunEnd: () => {
        setIsRevisionRequested(false)
        // Refetch state from backend to guarantee latest draft sync (P0-1)
        axios
          .get(`${API_BASE_URL}/api/protocols/${sessionId}/state`, {
            headers: { 'X-Session-Token': token }
          })
          .then((res) => {
            if (res.data?.state) {
              dispatch({ type: 'SET_SNAPSHOT', snapshot: res.data.state })
              if (res.data.state.current_draft) {
                setEditedDraft(res.data.state.current_draft)
                setInitialDraftBeforeEdit(res.data.state.current_draft)
              }
            }
          })
          .catch((err) => console.warn('Could not refetch state on run_end:', err))
      }
    })

    streamClientRef.current = client
    client.start()
  }, [showToast])

  // Persist under the hood toggle in localStorage (P1-4)
  useEffect(() => {
    const saved = localStorage.getItem('cerina_under_the_hood')
    if (saved === 'true' && !state.uiState.underTheHood) {
      dispatch({ type: 'TOGGLE_UNDER_THE_HOOD' })
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('cerina_under_the_hood', String(state.uiState.underTheHood))
  }, [state.uiState.underTheHood])

  // Active stage from latest unmatched node_start (P0-2)
  const activeStageText = useMemo(() => {
    if (!state.events || state.events.length === 0) return 'Starting…'
    const starts = state.events.filter((e) => e.type === 'node_start')
    const ends = state.events.filter((e) => e.type === 'node_end')
    for (let i = starts.length - 1; i >= 0; i--) {
      const st = starts[i]
      const matchingEnd = ends.find((en) => en.agent === st.agent && en.seq > st.seq)
      if (!matchingEnd) {
        if (st.agent === 'Drafter') return 'Drafting clinical structure…'
        if (st.agent === 'SafetyGuardian') return 'Auditing safety guidelines…'
        if (st.agent === 'ClinicalCritic') return 'Evaluating empathy & fidelity…'
        if (st.agent === 'Supervisor') return 'Synthesizing rubric decisions…'
        return st.text || 'Processing…'
      }
    }
    return 'Starting…'
  }, [state.events])

  const lastEventTs = useMemo(() => {
    if (!state.events || state.events.length === 0) return undefined
    return state.events[state.events.length - 1].ts
  }, [state.events])

  // Stop stream when leaving or resetting
  useEffect(() => {
    return () => {
      if (streamClientRef.current) {
        streamClientRef.current.stop()
      }
    }
  }, [])

  // Auto-resume & URL query (?s=<id>) handler (B2)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const sParam = urlParams.get('s')

    if (sParam) {
      const stored = getSession(sParam)
      if (stored && stored.token) {
        // Known session in this browser
        dispatch({
          type: 'SET_SESSION',
          sessionId: stored.id,
          token: stored.token,
          intent: stored.intent,
          reviewDepth: stored.review_depth
        })

        // Fetch state snapshot
        axios
          .get(`${API_BASE_URL}/api/protocols/${stored.id}/state`, {
            headers: { 'X-Session-Token': stored.token }
          })
          .then((res) => {
            if (res.data?.state) {
              dispatch({ type: 'SET_SNAPSHOT', snapshot: res.data.state })
            }
          })
          .catch((err) => console.warn('Could not restore snapshot:', err))

        // Connect SSE stream
        connectStream(stored.id, stored.token)

        const timeStr = new Date(stored.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        setResumeBanner(`Resumed your session from ${timeStr}`)
      } else {
        // Unknown session token in this browser (B2)
        setBrowserMismatchAlert(true)
      }
    } else {
      // Clean idle check: auto-resume only unfinished session (<24h)
      const auto = getAutoResumeSession()
      if (auto && auto.token) {
        window.history.replaceState(null, '', `?s=${auto.id}`)
        dispatch({
          type: 'SET_SESSION',
          sessionId: auto.id,
          token: auto.token,
          intent: auto.intent,
          reviewDepth: auto.review_depth
        })

        axios
          .get(`${API_BASE_URL}/api/protocols/${auto.id}/state`, {
            headers: { 'X-Session-Token': auto.token }
          })
          .then((res) => {
            if (res.data?.state) {
              dispatch({ type: 'SET_SNAPSHOT', snapshot: res.data.state })
            }
          })
          .catch((err) => console.warn('Could not restore snapshot:', err))

        connectStream(auto.id, auto.token)
        const timeStr = new Date(auto.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        setResumeBanner(`Resumed your session from ${timeStr}`)
      }
    }
  }, [connectStream])

  // Browser title management
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

  // Session start handler (B2, B4)
  const handleSessionStart = ({
    sessionId,
    sessionToken,
    status,
    intent,
    reviewDepth,
    careResources
  }: {
    sessionId: string
    sessionToken: string
    status: string
    intent: string
    reviewDepth: 'standard' | 'thorough'
    careResources?: any
  }) => {
    // Save to localStorage recent 5 sessions
    saveSession({
      id: sessionId,
      token: sessionToken,
      intent,
      status,
      updated_at: new Date().toISOString(),
      review_depth: reviewDepth
    })

    // Update URL query ?s=<id>
    window.history.replaceState(null, '', `?s=${sessionId}`)

    dispatch({
      type: 'SET_SESSION',
      sessionId,
      token: sessionToken,
      intent,
      reviewDepth
    })

    if (careResources) {
      dispatch({ type: 'SET_CARE_PANEL', careResources })
    }

    if (status !== 'care_panel') {
      connectStream(sessionId, sessionToken)
    }
  }

  // Resume a recent session from menu or idle banner
  const handleSelectRecentSession = (stored: StoredSession) => {
    window.history.replaceState(null, '', `?s=${stored.id}`)
    dispatch({
      type: 'SET_SESSION',
      sessionId: stored.id,
      token: stored.token,
      intent: stored.intent,
      reviewDepth: stored.review_depth
    })

    axios
      .get(`${API_BASE_URL}/api/protocols/${stored.id}/state`, {
        headers: { 'X-Session-Token': stored.token }
      })
      .then((res) => {
        if (res.data?.state) {
          dispatch({ type: 'SET_SNAPSHOT', snapshot: res.data.state })
        }
      })
      .catch((err) => console.warn('Could not restore snapshot:', err))

    connectStream(stored.id, stored.token)
    const timeStr = new Date(stored.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setResumeBanner(`Resumed your session from ${timeStr}`)
  }

  // Edit actions
  const handleStartEditing = () => {
    setEditedDraft(state.draft)
    setInitialDraftBeforeEdit(state.draft)
    dispatch({ type: 'SET_UI_MODE', mode: 'editing' })
    showToast('Entered clinician edit mode', 'info')
  }

  const handleDiscardEdits = () => {
    setEditedDraft(initialDraftBeforeEdit)
    dispatch({ type: 'SET_UI_MODE', mode: 'default' })
    showToast('Edits discarded', 'info')
  }

  const handleDraftChange = (newText: string) => {
    setEditedDraft(newText)
    if (validationStatus !== 'stale') {
      setValidationStatus('stale')
    }
  }

  // Revalidate only (A8)
  const handleRevalidateOnly = async () => {
    if (!state.sessionId || !state.sessionToken) return
    setValidationStatus('checking')

    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/revalidate`,
        { draft: editedDraft },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )
      const data = res.data
      const passes = data.safety_score >= 0.8 && data.empathy_score >= 0.7 && data.clinical_score >= 0.7
      if (passes) {
        setValidationStatus('passed')
        setLastValidatedHash(data.validated_hash || 'OK')
        showToast('Safety check passed for updated draft', 'success')
      } else {
        setValidationStatus('failed')
        showToast('Validation below required threshold', 'error')
      }
    } catch (err: any) {
      setValidationStatus('failed')
      showToast('Validation request failed', 'error')
    }
  }

  // Save edits and approve
  const handleSaveEditsAndApprove = async () => {
    if (!state.sessionId || !state.sessionToken) return

    dispatch({ type: 'SET_UI_MODE', mode: 'approving' })
    try {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
      const res = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/approve`,
        {
          approved_content: editedDraft,
          approved_by: 'Clinical Supervisor',
          edited: true,
          validated_hash: lastValidatedHash || 'EDITED'
        },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )

      setApprovalTime(now)
      dispatch({ type: 'SET_DRAFT', draft: editedDraft })
      dispatch({ type: 'ADD_EVENT', event: {
        session_id: state.sessionId,
        seq: state.events.length + 1,
        run_id: state.activeRunId || 'approval',
        run_kind: 'approval',
        draft_version: state.draftVersion,
        agent: 'Human',
        type: 'approval',
        severity: 'info',
        text: 'Protocol approved and locked by Clinical Supervisor.',
        data: {
          approved_by: 'Clinical Supervisor',
          approved_at: now,
          content_hash: res.data?.approval_audit?.content_hash
        },
        ts: new Date().toISOString()
      }})
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      updateSessionStatus(state.sessionId, 'approved', editedDraft)
      showToast('Protocol approved & locked with edits', 'success')
    } catch (err: any) {
      dispatch({ type: 'SET_UI_MODE', mode: 'editing' })
      showToast('Approval request failed', 'error')
    }
  }

  // Direct approve without edits
  const handleApprove = async () => {
    if (!state.sessionId || !state.sessionToken) return

    dispatch({ type: 'SET_UI_MODE', mode: 'approving' })
    try {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
      const res = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/approve`,
        {
          approved_by: 'Clinical Supervisor',
          edited: false,
          validated_hash: 'BASELINE'
        },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )

      setApprovalTime(now)
      dispatch({ type: 'ADD_EVENT', event: {
        session_id: state.sessionId,
        seq: state.events.length + 1,
        run_id: state.activeRunId || 'approval',
        run_kind: 'approval',
        draft_version: state.draftVersion,
        agent: 'Human',
        type: 'approval',
        severity: 'info',
        text: 'Protocol approved and locked by Clinical Supervisor.',
        data: {
          approved_by: 'Clinical Supervisor',
          approved_at: now,
          content_hash: res.data?.approval_audit?.content_hash
        },
        ts: new Date().toISOString()
      }})
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      updateSessionStatus(state.sessionId, 'approved')
      showToast('Protocol approved & locked', 'success')
    } catch (err: any) {
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      showToast('Approval request failed', 'error')
    }
  }

  // Human steering / Request Revision (A8, C7)
  const handleRequestRevision = async (instruction?: string, concernIds?: string[]) => {
    if (!state.sessionId || !state.sessionToken) return
    setIsRevisionRequested(true)

    try {
      await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/revise`,
        {
          instruction: instruction || 'Please address open clinical critique items.',
          concern_ids: concernIds || []
        },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )
      showToast('Revision requested · agents working', 'info')
    } catch (err: any) {
      setIsRevisionRequested(false)
      showToast('Failed to trigger revision run', 'error')
    }
  }

  // Export PDF (Phase E)
  const handleExportPdf = async () => {
    const draftText = editedDraft || state.draft || ''
    if (!draftText.trim()) {
      showToast('No protocol content available to export', 'error')
      return
    }

    try {
      const filename = await exportClinicalPdf(
        draftText,
        state.approvalAudit,
        {
          safety: state.scores.safety_score,
          empathy: state.scores.empathy_score,
          clinical: state.scores.clinical_score,
        }
      )
      showToast(`Saved ${filename}`, 'success')
    } catch (err: any) {
      showToast(`PDF Export error: ${err.message}`, 'error')
    }
  }

  const handleCopyMarkdown = () => {
    const draftText = editedDraft || state.draft || ''
    navigator.clipboard.writeText(draftText)
    showToast('Protocol markdown copied to clipboard', 'success')
  }

  const handleNewProtocol = () => {
    if (phase === 'editing' && (wordsAdded > 0 || wordsRemoved > 0)) {
      if (!window.confirm('You have unsaved edits. Discard and start a new protocol?')) {
        return
      }
    }
    window.history.replaceState(null, '', window.location.pathname)
    if (streamClientRef.current) streamClientRef.current.stop()
    dispatch({ type: 'RESET' })
    setEditedDraft('')
    setInitialDraftBeforeEdit('')
    setResumeBanner(null)
    setBrowserMismatchAlert(false)
    showToast('Ready for new protocol', 'info')
  }

  // Recorded Demo Run Replay (D8)
  const handleWatchRecordedRun = async () => {
    try {
      const res = await fetch('/demo/sample-run.json')
      if (!res.ok) throw new Error('Sample run not found')
      const demoData = await res.json()

      dispatch({ type: 'RESET' })
      dispatch({
        type: 'SET_SESSION',
        sessionId: demoData.session_id || 'demo_recorded_run',
        token: 'demo_token',
        intent: demoData.intent || 'Cognitive Restructuring Thought Record Demo',
        reviewDepth: 'standard'
      })

      dispatch({ type: 'SET_REPLAY_MODE', isReplay: true })

      // Feed recorded events with progressive timing
      const events: ProtocolEvent[] = demoData.events || []
      let delay = 0
      for (const evt of events) {
        setTimeout(() => {
          dispatch({ type: 'ADD_EVENT', event: evt })
          if (evt.type === 'node_end' && evt.agent === 'Drafter' && evt.data?.draft) {
            dispatch({ type: 'SET_DRAFT', draft: evt.data.draft, version: evt.draft_version })
            setEditedDraft(evt.data.draft)
          }
        }, delay)
        delay += 350
      }
      showToast('Loaded recorded run demo', 'info')
    } catch (_) {
      showToast('Recorded run sample file will be available after generation', 'info')
    }
  }

  // Major concerns list for revision popover chips (C7)
  const majorConcerns = useMemo(() => {
    return state.events
      .filter((e) => (e.severity === 'warning' || e.severity === 'major') && e.type === 'message')
      .map((e, idx) => ({ id: `concern_${idx}`, text: e.text }))
  }, [state.events])

  return (
    <LayoutGroup>
      <div className="h-screen max-h-screen overflow-hidden grid grid-rows-[auto_auto_minmax(0,1fr)] bg-[#FAF8F5] text-[#18221E] select-none">
        {/* Row 1: Header Bar */}
        <Header
          phase={phase}
          sessionId={state.sessionId || undefined}
          underTheHood={state.uiState.underTheHood}
          onToggleUnderTheHood={() => dispatch({ type: 'TOGGLE_UNDER_THE_HOOD' })}
          onNewProtocol={handleNewProtocol}
          onSelectSession={handleSelectRecentSession}
        />

        {/* Row 2: In-Grid Notification Banners (never pushes shell taller than viewport) */}
        <div className="shrink-0 flex flex-col">
          {/* Persistent Replay Badge (D8) */}
          {state.uiState.isReplay && (
            <aside role="region" aria-label="Recorded run status" className="bg-[#FAF8F5] border-b border-[#E8E4DA] px-4 py-1.5 text-xs text-[#244F3B] font-semibold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#244F3B] animate-pulse" />
                <span>Recorded run · no live AI calls</span>
              </div>
              <button
                type="button"
                onClick={handleNewProtocol}
                className="text-xs text-[#55635C] hover:text-[#18221E] underline font-medium"
              >
                Exit replay
              </button>
            </aside>
          )}

          {/* Browser Mismatch Alert (B2) */}
          {browserMismatchAlert && (
            <aside role="alert" aria-label="Browser mismatch alert" className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 py-2 text-xs text-[#92400E] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#D97706]" />
                <span>This protocol belongs to another browser. Your active session token is not stored locally.</span>
              </div>
              <button
                type="button"
                onClick={handleNewProtocol}
                className="font-semibold underline hover:text-[#78350F]"
              >
                Start new protocol
              </button>
            </aside>
          )}

          {/* Resume Banner (B2) */}
          {resumeBanner && phase !== 'idle' && (
            <aside role="status" aria-label="Session resume notification" className="bg-[#EBF3EE] border-b border-[#C2DBCB] px-4 py-1.5 text-xs text-[#1E3D2F] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
                <span>{resumeBanner}</span>
              </div>
              <button
                type="button"
                onClick={handleNewProtocol}
                className="text-[#244F3B] font-semibold hover:underline"
              >
                Start new
              </button>
            </aside>
          )}

          {/* Human Checkpoint Safe Notification (B2) */}
          {phase === 'review' && (
            <div role="status" aria-label="Review checkpoint status" className="bg-[#F0ECE3] border-b border-[#E8E4DA] px-4 py-1 text-[11px] text-[#55635C] text-center">
              Saved — you can close this tab; your review will wait.
            </div>
          )}
        </div>

        {/* Row 3: Main Workspace Shell */}
        <main className="min-h-0 overflow-hidden max-w-[1600px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-2.5 sm:py-3 flex flex-col">
          {/* =========================================================================
              PHASE: CARE_PANEL (A10 Crisis Pre-Screen)
             ========================================================================= */}
          {phase === 'care_panel' ? (
            <CarePanel
              resources={state.careResources}
              onClinicianContinue={() => {
                if (state.userIntent) {
                  // Clinician bypass continue
                  axios
                    .post(`${API_BASE_URL}/api/protocols/create`, {
                      intent: state.userIntent,
                      review_depth: state.reviewDepth,
                      clinician_bypass: true
                    })
                    .then((res) => {
                      handleSessionStart({
                        sessionId: res.data.session_id,
                        sessionToken: res.data.session_token,
                        status: res.data.status,
                        intent: state.userIntent,
                        reviewDepth: state.reviewDepth
                      })
                    })
                    .catch(() => showToast('Failed to continue clinician run', 'error'))
                }
              }}
              onStartNew={handleNewProtocol}
            />
          ) : phase === 'idle' ? (
            /* =========================================================================
                PHASE: IDLE (Clean Hero + Form + Pipeline Explainer)
               ========================================================================= */
            <AnimatePresence mode="wait">
              <motion.div
                key="idle-view"
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full flex flex-col justify-center max-w-5xl mx-auto space-y-4 sm:space-y-6"
              >
                {/* Hero Header (P2) */}
                <div className="text-center space-y-2 pt-2">
                  <div className="flex items-center justify-center">
                    <svg className="w-5 h-5 text-[#244F3B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 2C8 6 4 12 12 22M12 7c-2 1-4 3-4 5m4-7c2 1 4 3 4 5" strokeLinecap="round" />
                    </svg>
                  </div>

                  <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-[#18221E] font-medium tracking-tight">
                    Design structured CBT exercises with clinical precision.
                  </h1>

                  <p className="font-serif italic text-sm text-[#244F3B]/80 max-w-md mx-auto">
                    Evidence-based protocol authoring for clinical excellence
                  </p>
                </div>

                {/* 2-Column Split: Form + Pipeline Explainer (C1) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                  <div className="md:col-span-7">
                    <ProtocolCreator
                      onSessionStart={handleSessionStart}
                      onResumeSession={handleSelectRecentSession}
                      onWatchRecordedRun={handleWatchRecordedRun}
                    />
                  </div>

                  <div className="md:col-span-5">
                    <AgentPipeline events={[]} isIdle={true} />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            /* =========================================================================
                ACTIVE PHASES: generating | review | editing | approving | approved
                3-Column Shell (Single Scroll Surface in Document Pane)
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

              {/* 3-Column Container */}
              <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* =====================================================================
                    1. LEFT RAIL (280px, NEVER SCROLLS)
                   ===================================================================== */}
                <div className="hidden 2xl:flex w-[280px] shrink-0 flex-col gap-2.5 overflow-hidden select-none h-full">
                  <IntentSummary
                    intent={state.userIntent || ''}
                    draftVersion={state.draftVersion || 1}
                    maxIterations={3}
                    phase={phase}
                    onNewProtocol={handleNewProtocol}
                  />

                  <div className="shrink-0 max-h-[380px] overflow-hidden">
                    <AgentPipeline events={state.events} />
                  </div>

                  <div className="flex-1 min-h-[140px] overflow-hidden">
                    <Outline content={state.draft || editedDraft} scrollerRef={scrollerRef} />
                  </div>
                </div>

                {/* =====================================================================
                    2. CENTER PANE: DocumentViewer (THE ONLY SCROLLER)
                   ===================================================================== */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`flex-1 min-w-0 h-full flex flex-col gap-2 overflow-hidden ${
                    mobileTab !== 'document' ? 'hidden lg:flex' : 'flex'
                  }`}
                >
                  {/* Compact Mode Strip (<1536px): Horizontal Pipeline */}
                  <div className="hidden lg:block 2xl:hidden shrink-0">
                    <AgentPipeline events={state.events} compact={true} />
                  </div>

                  {/* DocumentViewer with Outermost Scroller */}
                  <div className="flex-1 overflow-hidden min-h-0">
                    <DocumentViewer
                      phase={phase}
                      draft={state.draft}
                      editedDraft={editedDraft}
                      streamingTokens={state.streamingTokenBuffer}
                      draftVersion={state.draftVersion}
                      hasUserEdits={editedDraft !== initialDraftBeforeEdit}
                      revisionSummaries={state.revisionSummaries}
                      isSafetyCriticRunning={phase === 'generating' && Boolean(state.draft)}
                      elapsedSeconds={elapsedSeconds}
                      sessionId={state.sessionId || undefined}
                      activeStageText={activeStageText}
                      lastEventTs={lastEventTs}
                      isReplay={state.uiState.isReplay}
                      hasRevisedRun={state.events.some((e) => e.run_kind === 'revision')}
                      scrollerRef={scrollerRef}
                      onDraftChange={handleDraftChange}
                      onStartEditing={handleStartEditing}
                      onSaveEditsAndApprove={handleSaveEditsAndApprove}
                      onDiscardEdits={handleDiscardEdits}
                      onExportPdf={handleExportPdf}
                    />
                  </div>
                </motion.div>

                {/* =====================================================================
                    3. RIGHT RAIL (360px grid: [auto scores] [minmax(0,1fr) feed] [auto ActionPanel])
                   ===================================================================== */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`w-full lg:w-[350px] 2xl:w-[370px] shrink-0 h-full grid grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 overflow-hidden select-none ${
                    mobileTab !== 'review' ? 'hidden lg:grid' : 'grid'
                  }`}
                >
                  {/* Row 1: Clinical Rubric Scores (C3) - Compact */}
                  <div className="shrink-0">
                    <ScoreMeters
                      scores={state.scores}
                      previousScores={state.previousScores}
                    />
                  </div>

                  {/* Row 2: Live Agent Feed (C2) - Fills available middle space, whole cards only */}
                  <div className="min-h-0 overflow-hidden">
                    <LiveAgentFeed
                      events={state.events}
                      onOpenTimeline={() => setIsTimelineOpen(true)}
                    />
                  </div>

                  {/* Row 3: Desktop Pinned ActionPanel (C7) - Pinned, never clipped */}
                  <div className="shrink-0">
                    <ActionPanel
                      phase={phase}
                      validationStatus={validationStatus}
                      hasEdits={editedDraft !== initialDraftBeforeEdit}
                      wordsAdded={wordsAdded}
                      wordsRemoved={wordsRemoved}
                      approvalTime={approvalTime}
                      majorConcerns={majorConcerns}
                      isRevisionRequested={isRevisionRequested}
                      onApprove={handleApprove}
                      onStartEditing={handleStartEditing}
                      onSaveEditsAndApprove={handleSaveEditsAndApprove}
                      onRevalidateOnly={handleRevalidateOnly}
                      onDiscardEdits={handleDiscardEdits}
                      onExportPdf={handleExportPdf}
                      onCopyMarkdown={handleCopyMarkdown}
                      onNewProtocol={handleNewProtocol}
                      onRequestRevision={handleRequestRevision}
                    />
                  </div>
                </motion.div>
              </div>

              {/* Mobile Sticky ActionPanel */}
              <div className="lg:hidden shrink-0 pt-2 border-t border-[#E8E4DA] bg-[#FAF8F5]">
                <ActionPanel
                  phase={phase}
                  validationStatus={validationStatus}
                  hasEdits={editedDraft !== initialDraftBeforeEdit}
                  wordsAdded={wordsAdded}
                  wordsRemoved={wordsRemoved}
                  approvalTime={approvalTime}
                  majorConcerns={majorConcerns}
                  isRevisionRequested={isRevisionRequested}
                  onApprove={handleApprove}
                  onStartEditing={handleStartEditing}
                  onSaveEditsAndApprove={handleSaveEditsAndApprove}
                  onRevalidateOnly={handleRevalidateOnly}
                  onDiscardEdits={handleDiscardEdits}
                  onExportPdf={handleExportPdf}
                  onCopyMarkdown={handleCopyMarkdown}
                  onNewProtocol={handleNewProtocol}
                  onRequestRevision={handleRequestRevision}
                />
              </div>
            </div>
          )}
        </main>

        {/* Timeline Sheet (C4) */}
        <TimelineSheet
          isOpen={isTimelineOpen}
          onOpenChange={setIsTimelineOpen}
          events={state.events}
          underTheHood={state.uiState.underTheHood}
          onToggleUnderTheHood={() => dispatch({ type: 'TOGGLE_UNDER_THE_HOOD' })}
        />
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
