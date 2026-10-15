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
import ReviewDetailsSheet from './components/ReviewDetailsSheet'
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
import { Activity, FileText, CheckCircle2, AlertCircle, X } from 'lucide-react'

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
  const [, setLastValidatedHash] = useState<string | null>(null)
  const [approvalTime, setApprovalTime] = useState<string | undefined>(undefined)
  const [isRevisionRequested, setIsRevisionRequested] = useState<boolean>(false)

  // Sheet & UI view states
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false)
  const [isReviewDetailsOpen, setIsReviewDetailsOpen] = useState<boolean>(false)
  const [mobileTab, setMobileTab] = useState<'document' | 'review'>('document')
  const [resumeBanner, setResumeBanner] = useState<string | null>(null)
  const [showReviewSaveNotice, setShowReviewSaveNotice] = useState<boolean>(true)
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
  const connectStream = useCallback((sessionId: string, token: string, fromSeq?: number) => {
    if (streamClientRef.current) {
      streamClientRef.current.stop()
    }

    const maxSeq = fromSeq !== undefined ? fromSeq : (state.events.length > 0 ? Math.max(...state.events.map((e) => e.seq || 0)) : 0)

    const client = new ProtocolStreamClient({
      sessionId,
      sessionToken: token,
      lastEventId: maxSeq,
      onEvent: (event: ProtocolEvent) => {
        dispatch({ type: 'ADD_EVENT', event })

        // Synchronize canonical draft on draft event, Drafter node_end, checkpoint, or run_end (P0-1)
        if ((event.type === 'draft' || (event.type === 'node_end' && event.agent === 'Drafter') || event.type === 'checkpoint' || event.type === 'run_end') && event.data?.draft) {
          dispatch({ type: 'SET_DRAFT', draft: event.data.draft, version: event.draft_version || event.data.version || 1 })
          setEditedDraft(event.data.draft)
          if (!initialDraftBeforeEdit) {
            setInitialDraftBeforeEdit(event.data.draft)
            sessionStorage.setItem(`cerina_baseline_draft_${sessionId}`, event.data.draft)
          }
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
                const base = res.data.state.draft_history?.[0]?.content || res.data.state.current_draft
                if (!initialDraftBeforeEdit && base) {
                  setInitialDraftBeforeEdit(base)
                  sessionStorage.setItem(`cerina_baseline_draft_${sessionId}`, base)
                }
              }
            }
          })
          .catch((err) => console.warn('Could not refetch state on run_end:', err))
      }
    })

    streamClientRef.current = client
    client.start()
  }, [showToast])


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
              const baseline = res.data.state.draft_history?.[0]?.content || res.data.state.current_draft || ''
              if (baseline) {
                setInitialDraftBeforeEdit(baseline)
                sessionStorage.setItem(`cerina_baseline_draft_${stored.id}`, baseline)
              }
            }
          })
          .catch((err) => console.warn('Could not restore snapshot:', err))

        // Fetch complete event history on resume (P0-1)
        axios
          .get(`${API_BASE_URL}/api/protocols/${stored.id}/events?after=0`, {
            headers: { 'X-Session-Token': stored.token }
          })
          .then((evtRes) => {
            if (evtRes.data?.events && evtRes.data.events.length > 0) {
              dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
            }
          })
          .catch((err) => console.warn('Could not fetch events on resume:', err))

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
              const baseline = res.data.state.draft_history?.[0]?.content || res.data.state.current_draft || ''
              if (baseline) {
                setInitialDraftBeforeEdit(baseline)
                sessionStorage.setItem(`cerina_baseline_draft_${auto.id}`, baseline)
              }
            }
          })
          .catch((err) => console.warn('Could not restore snapshot:', err))

        axios
          .get(`${API_BASE_URL}/api/protocols/${auto.id}/events?after=0`, {
            headers: { 'X-Session-Token': auto.token }
          })
          .then((evtRes) => {
            if (evtRes.data?.events && evtRes.data.events.length > 0) {
              dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
            }
          })
          .catch((err) => console.warn('Could not fetch events on auto-resume:', err))

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

  // Auto-dismiss resume banner after 5s
  useEffect(() => {
    if (resumeBanner) {
      const timer = setTimeout(() => setResumeBanner(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [resumeBanner])

  // Reset & auto-dismiss review checkpoint notification after 5s when entering review
  useEffect(() => {
    if (phase === 'review') {
      setShowReviewSaveNotice(true)
      const timer = setTimeout(() => setShowReviewSaveNotice(false), 5000)
      return () => clearTimeout(timer)
    } else {
      setShowReviewSaveNotice(false)
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
          const baseline = res.data.state.draft_history?.[0]?.content || res.data.state.current_draft || ''
          if (baseline) {
            setInitialDraftBeforeEdit(baseline)
            sessionStorage.setItem(`cerina_baseline_draft_${stored.id}`, baseline)
          }
        }
      })
      .catch((err) => console.warn('Could not restore snapshot:', err))

    axios
      .get(`${API_BASE_URL}/api/protocols/${stored.id}/events?after=0`, {
        headers: { 'X-Session-Token': stored.token }
      })
      .then((evtRes) => {
        if (evtRes.data?.events && evtRes.data.events.length > 0) {
          dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
        }
      })
      .catch((err) => console.warn('Could not fetch events on select session:', err))

    connectStream(stored.id, stored.token)
    const timeStr = new Date(stored.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setResumeBanner(`Resumed your session from ${timeStr}`)
  }

  // Edit actions
  const handleStartEditing = () => {
    setEditedDraft(state.draft)
    if (!initialDraftBeforeEdit) {
      setInitialDraftBeforeEdit(state.draft)
      if (state.sessionId) {
        sessionStorage.setItem(`cerina_baseline_draft_${state.sessionId}`, state.draft)
      }
    }
    dispatch({ type: 'SET_UI_MODE', mode: 'editing' })
    showToast('Entered edit mode', 'info')
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
      const passes = Boolean(data.passed ?? (data.safety_score >= 0.8 && data.empathy_score >= 3.5 && data.clinical_score >= 3.5))
      if (passes) {
        setValidationStatus('passed')
        setLastValidatedHash(data.validated_hash || 'OK')
        showToast('Safety & clinical checks passed for updated draft', 'success')
      } else {
        setValidationStatus('failed')
        const reason = data.safety_score < 0.8
          ? `Safety check failed (${Math.round((data.safety_score || 0) * 5)}/5 criteria passed)`
          : `Clinical score below threshold (Empathy: ${data.empathy_score?.toFixed(1) || 0}/5, Fidelity: ${data.clinical_score?.toFixed(1) || 0}/5)`
        showToast(reason, 'error')
      }

      // Fetch latest events from backend to reflect recheck scores in UI meters
      try {
        const evtRes = await axios.get(
          `${API_BASE_URL}/api/protocols/${state.sessionId}/events?after=0`,
          { headers: { 'X-Session-Token': state.sessionToken } }
        )
        if (evtRes.data?.events) {
          dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
        }
      } catch (e) {
        console.warn('Could not fetch events after revalidate:', e)
      }
    } catch (err: any) {
      setValidationStatus('failed')
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : detail?.message || err.message || 'Validation request failed'
      showToast(msg, 'error')
    }
  }

  // Save edits and approve (Round 4: Re-check & approve with live events)
  const handleSaveEditsAndApprove = async () => {
    if (!state.sessionId || !state.sessionToken) return

    dispatch({ type: 'SET_UI_MODE', mode: 'approving' })
    try {
      showToast('Re-checking your edits…', 'info')

      // 1. Run revalidation first
      const revalRes = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/revalidate`,
        { draft: editedDraft },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )
      const valData = revalRes.data
      if (!valData.passed) {
        dispatch({ type: 'SET_UI_MODE', mode: 'editing' })
        const reason = valData.safety_score < 0.8
          ? `Safety check failed (${Math.round((valData.safety_score || 0) * 5)}/5 criteria passed)`
          : `Clinical score below threshold (Empathy: ${valData.empathy_score?.toFixed(1) || 0}/5, Fidelity: ${valData.clinical_score?.toFixed(1) || 0}/5)`
        showToast(reason, 'error')
        return
      }

      const valHash = valData.validated_hash

      // 2. Approve with validated hash and "You" attribution
      const appRes = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/approve`,
        {
          approved_content: editedDraft,
          approved_by: 'You',
          edited: true,
          validated_hash: valHash
        },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )

      const approvalAudit = appRes.data?.audit
      const approvedIso = approvalAudit?.approved_at || new Date().toISOString()
      setApprovalTime(approvedIso)

      // Immediately dispatch approval event so UI transitions synchronously to approved
      const approvalEvent: ProtocolEvent = {
        session_id: state.sessionId || '',
        seq: (state.events.length > 0 ? Math.max(...state.events.map((e) => e.seq || 0)) : 0) + 1,
        run_id: 'run_approval',
        run_kind: 'approval',
        draft_version: state.draftVersion,
        agent: 'Human',
        type: 'approval',
        text: 'Protocol approved with edits by You',
        severity: 'info',
        ts: approvedIso,
        data: approvalAudit
      }
      dispatch({ type: 'ADD_EVENT', event: approvalEvent })
      dispatch({ type: 'SET_DRAFT', draft: editedDraft })
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      updateSessionStatus(state.sessionId, 'approved', editedDraft)
      showToast('Protocol approved & locked with edits', 'success')

      // 3. Fetch real events from backend
      try {
        const evtRes = await axios.get(
          `${API_BASE_URL}/api/protocols/${state.sessionId}/events?after=0`,
          { headers: { 'X-Session-Token': state.sessionToken } }
        )
        if (evtRes.data?.events) {
          dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
        }
      } catch (e) {
        console.warn('Could not fetch events after approval:', e)
      }
    } catch (err: any) {
      dispatch({ type: 'SET_UI_MODE', mode: 'editing' })
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : detail?.message || err.message || 'Approval request failed'
      showToast(msg, 'error')
    }
  }

  // Direct approve without edits
  const handleApprove = async () => {
    if (!state.sessionId || !state.sessionToken) return

    dispatch({ type: 'SET_UI_MODE', mode: 'approving' })
    try {
      const appRes = await axios.post(
        `${API_BASE_URL}/api/protocols/${state.sessionId}/approve`,
        {
          approved_by: 'You',
          edited: false,
          validated_hash: 'BASELINE'
        },
        { headers: { 'X-Session-Token': state.sessionToken } }
      )

      const approvalAudit = appRes.data?.audit
      const approvedIso = approvalAudit?.approved_at || new Date().toISOString()
      setApprovalTime(approvedIso)

      // Immediately dispatch approval event so UI transitions synchronously to approved
      const approvalEvent: ProtocolEvent = {
        session_id: state.sessionId || '',
        seq: (state.events.length > 0 ? Math.max(...state.events.map((e) => e.seq || 0)) : 0) + 1,
        run_id: 'run_approval',
        run_kind: 'approval',
        draft_version: state.draftVersion,
        agent: 'Human',
        type: 'approval',
        text: 'Protocol approved by You',
        severity: 'info',
        ts: approvedIso,
        data: approvalAudit
      }
      dispatch({ type: 'ADD_EVENT', event: approvalEvent })
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      updateSessionStatus(state.sessionId, 'approved')
      showToast('Protocol approved & locked', 'success')

      // Fetch real events from backend
      try {
        const evtRes = await axios.get(
          `${API_BASE_URL}/api/protocols/${state.sessionId}/events?after=0`,
          { headers: { 'X-Session-Token': state.sessionToken } }
        )
        if (evtRes.data?.events) {
          dispatch({ type: 'BATCH_EVENTS', events: evtRes.data.events })
        }
      } catch (e) {
        console.warn('Could not fetch events after approval:', e)
      }
    } catch (err: any) {
      dispatch({ type: 'SET_UI_MODE', mode: 'default' })
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : detail?.message || err.message || 'Approval request failed'
      showToast(msg, 'error')
    }
  }

  // Human steering / Request Revision (A8, C7)
  const handleRequestRevision = async (instruction?: string, concernIds?: string[]) => {
    if (!state.sessionId || !state.sessionToken) return
    setIsRevisionRequested(true)
    const currentMaxSeq = state.events.reduce((max, e) => Math.max(max, e.seq || 0), 0)

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
      connectStream(state.sessionId, state.sessionToken, currentMaxSeq)
    } catch (err: any) {
      setIsRevisionRequested(false)
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : detail?.message || err.message || 'Failed to trigger revision run'
      showToast(msg, 'error')
    }
  }

  // Export PDF (Phase E, Round 5)
  const handleExportPdf = async (includeDetails: boolean = false) => {
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
        },
        state.userIntent,
        includeDetails,
        state.scores.dimensions
      )
      showToast(`Saved ${filename}`, 'success')
    } catch (err: any) {
      showToast(`PDF Export error: ${err.message}`, 'error')
      throw err
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

          {/* Resume Banner (B2) - Auto-dismisses after 5s or with X */}
          {resumeBanner && phase !== 'idle' && (
            <aside role="status" aria-label="Session resume notification" className="bg-[#EBF3EE] border-b border-[#C2DBCB] px-4 py-1.5 text-xs text-[#1E3D2F] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#244F3B]" />
                <span>{resumeBanner}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNewProtocol}
                  className="text-[#244F3B] font-semibold hover:underline cursor-pointer"
                >
                  Start new
                </button>
                <button
                  type="button"
                  onClick={() => setResumeBanner(null)}
                  className="p-1 rounded text-[#55635C] hover:text-[#18221E] hover:bg-[#C2DBCB]/40 transition-colors cursor-pointer"
                  aria-label="Dismiss banner"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </aside>
          )}

          {/* Human Checkpoint Safe Notification (B2) - Auto-dismisses after 5s or with X */}
          {phase === 'review' && showReviewSaveNotice && (
            <div role="status" aria-label="Review checkpoint status" className="bg-[#F0ECE3] border-b border-[#E8E4DA] px-4 py-1 text-[11px] text-[#55635C] flex items-center justify-between shrink-0">
              <div className="mx-auto flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-[#244F3B]" />
                <span>Saved — you can close this tab; your review will wait.</span>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewSaveNotice(false)}
                className="text-[#55635C] hover:text-[#18221E] p-0.5 cursor-pointer"
                aria-label="Dismiss notification"
              >
                <X className="w-3 h-3" />
              </button>
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
                    .catch(() => showToast('Failed to continue run', 'error'))
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
                    1. LEFT RAIL
                   ===================================================================== */}
                <div className="hidden 2xl:flex w-[310px] shrink-0 flex-col gap-2.5 h-full overflow-hidden min-h-0 pr-1.5 pb-2">
                  <div className="shrink-0">
                    <IntentSummary
                      intent={state.userIntent || ''}
                      draftVersion={state.draftVersion || 1}
                      maxIterations={3}
                      phase={phase}
                      onNewProtocol={handleNewProtocol}
                    />
                  </div>

                  <div className="flex-1 min-h-[160px] flex flex-col">
                    <AgentPipeline events={state.events} />
                  </div>

                  <div className="shrink-0 max-h-[220px] flex flex-col">
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
                      initialDraftBeforeEdit={initialDraftBeforeEdit}
                      revisionSummaries={state.revisionSummaries}
                      isSafetyCriticRunning={phase === 'generating' && Boolean(state.draft)}
                      elapsedSeconds={elapsedSeconds}
                      sessionId={state.sessionId || undefined}
                      activeStageText={activeStageText}
                      lastEventTs={lastEventTs}
                      isReplay={state.uiState.isReplay}
                      hasRevisedRun={state.events.some((e) => e.run_kind === 'revision' || e.run_kind === 'human_revision')}
                      v1Draft={state.events.find((e) => e.type === 'draft' && e.draft_version === 1)?.data?.draft || ''}
                      scrollerRef={scrollerRef}
                      scores={state.scores}
                      events={state.events}
                      audit={state.approvalAudit}
                      onDraftChange={handleDraftChange}
                      onStartEditing={handleStartEditing}
                      onSaveEditsAndApprove={handleSaveEditsAndApprove}
                      onDiscardEdits={handleDiscardEdits}
                      onExportPdf={handleExportPdf}
                      onOpenReviewDetails={() => setIsReviewDetailsOpen(true)}
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
                  className={`w-full lg:w-[350px] 2xl:w-[370px] shrink-0 h-full grid grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 overflow-hidden ${
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
                      onOpenReviewDetails={() => setIsReviewDetailsOpen(true)}
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
                  onOpenReviewDetails={() => setIsReviewDetailsOpen(true)}
                />
              </div>
            </div>
          )}
        </main>

        {/* Timeline Sheet */}
        <TimelineSheet
          isOpen={isTimelineOpen}
          onOpenChange={setIsTimelineOpen}
          events={state.events}
        />

        {/* AI Review Details Sheet */}
        <ReviewDetailsSheet
          isOpen={isReviewDetailsOpen}
          onClose={() => setIsReviewDetailsOpen(false)}
          scores={state.scores}
          events={state.events}
          draft={editedDraft || state.draft || ''}
          sessionId={state.sessionId}
          audit={state.approvalAudit}
          onExportPdf={(includeDetails) => {
            setIsReviewDetailsOpen(false)
            handleExportPdf(includeDetails)
          }}
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
