import { ProtocolEvent, ReducerState, Phase, UIState, ScoreData } from '../types'

export type ProtocolAction =
  | { type: 'SET_SESSION'; sessionId: string; token: string; intent: string; reviewDepth?: 'standard' | 'thorough' }
  | { type: 'ADD_EVENT'; event: ProtocolEvent }
  | { type: 'BATCH_EVENTS'; events: ProtocolEvent[] }
  | { type: 'APPEND_TOKEN'; token: string }
  | { type: 'CLEAR_TOKEN_BUFFER' }
  | { type: 'SET_DRAFT'; draft: string; version?: number }
  | { type: 'SET_SNAPSHOT'; snapshot: any }
  | { type: 'SET_UI_MODE'; mode: 'default' | 'editing' | 'approving' }
  | { type: 'TOGGLE_UNDER_THE_HOOD' }
  | { type: 'SET_TIMELINE_FILTER'; filter: 'all' | 'concerns' | 'decisions'; agent?: string }
  | { type: 'SET_CARE_PANEL'; careResources: any }
  | { type: 'SET_ERROR'; code: string; message: string; retryable: boolean }
  | { type: 'SET_REPLAY_MODE'; isReplay: boolean }
  | { type: 'RESET' }

export const initialUIState: UIState = {
  mode: 'default',
  underTheHood: false,
  timelineFilter: 'all',
  isReplay: false
}

export const initialReducerState: ReducerState = {
  sessionId: null,
  sessionToken: null,
  userIntent: '',
  reviewDepth: 'standard',
  events: [],
  draft: '',
  streamingTokenBuffer: '',
  draftVersion: 1,
  phase: 'idle',
  uiState: initialUIState,
  scores: {},
  activeRunId: null,
  revisionSummaries: []
}

/**
 * Pure derivation of application phase from events log and UI mode (B1)
 */
export function derivePhase(events: ProtocolEvent[], uiState: UIState): Phase {
  if (uiState.mode === 'editing') return 'editing'
  if (uiState.mode === 'approving') return 'approving'

  if (!events || events.length === 0) return 'idle'

  // Find the index of the last terminal event (checkpoint, run_end, approval, error)
  let lastTerminalIdx = -1
  let lastTerminalEvent: ProtocolEvent | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'run_end' || e.type === 'checkpoint' || e.type === 'approval' || e.type === 'error') {
      lastTerminalIdx = i
      lastTerminalEvent = e
      break
    }
  }

  // If there are events AFTER the last terminal event, a new run has commenced
  if (lastTerminalIdx !== -1 && lastTerminalIdx < events.length - 1) {
    const eventsAfterTerminal = events.slice(lastTerminalIdx + 1)
    const hasActiveWork = eventsAfterTerminal.some(
      (e) => e.type === 'node_start' || e.type === 'human_action' || e.type === 'token' || e.type === 'draft'
    )
    if (hasActiveWork) {
      return 'generating'
    }
  }

  // If the last terminal event was found and no active work started after it
  if (lastTerminalEvent) {
    if (lastTerminalEvent.type === 'error') {
      if (lastTerminalEvent.data?.code === 'quota_exceeded') return 'quota_exhausted'
      return 'review'
    }
    if (lastTerminalEvent.type === 'approval') return 'approved'
    if (lastTerminalEvent.type === 'checkpoint') {
      if (lastTerminalEvent.data?.status === 'care_panel') return 'care_panel'
      return 'review'
    }
    if (lastTerminalEvent.type === 'run_end') {
      if (lastTerminalEvent.data?.status === 'awaiting_approval') return 'review'
      if (lastTerminalEvent.data?.status === 'approved') return 'approved'
      if (lastTerminalEvent.data?.status === 'care_panel') return 'care_panel'
    }
  }

  // If there is any active node_start without matching node_end
  const nodeStarts = events.filter((e) => e.type === 'node_start').length
  const nodeEnds = events.filter((e) => e.type === 'node_end').length
  if (nodeStarts > nodeEnds) return 'generating'

  // If initial event is present but no checkpoint yet
  return 'generating'
}

export function protocolReducer(state: ReducerState, action: ProtocolAction): ReducerState {
  switch (action.type) {
    case 'SET_SESSION': {
      return {
        ...state,
        sessionId: action.sessionId,
        sessionToken: action.token,
        userIntent: action.intent,
        reviewDepth: action.reviewDepth || 'standard',
        events: [],
        draft: '',
        streamingTokenBuffer: '',
        draftVersion: 1,
        scores: {},
        phase: 'generating',
        uiState: { ...state.uiState, mode: 'default' },
        errorInfo: undefined
      }
    }

    case 'ADD_EVENT': {
      const e = action.event
      // Prevent duplicate seq
      if (state.events.some((existing) => existing.seq === e.seq && e.seq > 0)) {
        return state
      }

      const nextEvents = [...state.events, e].sort((a, b) => a.seq - b.seq)
      let nextScores: ScoreData = { ...state.scores }
      let prevScores = state.previousScores
      let nextDraft = state.draft
      let nextDraftVersion = state.draftVersion
      let nextRevisionSummaries = [...state.revisionSummaries]
      let nextErrorInfo = state.errorInfo

      if (e.draft_version) {
        nextDraftVersion = Math.max(nextDraftVersion, e.draft_version)
      }

      // Extract draft text from draft events, node_end, checkpoint or run_end (P0-1)
      if (e.data?.draft && typeof e.data.draft === 'string' && e.data.draft.trim().length > 0) {
        nextDraft = e.data.draft
        if (e.data.version || e.draft_version) {
          nextDraftVersion = Math.max(nextDraftVersion, e.data.version || e.draft_version)
        }
      } else if (e.type === 'draft' && e.data?.draft) {
        nextDraft = e.data.draft
        if (e.draft_version) nextDraftVersion = Math.max(nextDraftVersion, e.draft_version)
      }

      // Process score events
      if (e.type === 'score' && e.data) {
        const isDegraded = Boolean(e.data.degraded_review || nextScores.degraded_review)
        if (e.data.metric === 'safety') {
          const newSafety = e.data.score
          const delta = state.scores.safety_score !== undefined ? newSafety - state.scores.safety_score : undefined
          nextScores = {
            ...nextScores,
            safety_score: newSafety,
            safety_checks: e.data.checks,
            score_source: e.data.score_source,
            unavailable: e.data.unavailable,
            degraded_review: isDegraded,
            delta_safety: delta
          }
        } else if (e.data.metric === 'clinical') {
          const newEmpathy = e.data.empathy_score
          const newClinical = e.data.clinical_score
          const deltaEmp = state.scores.empathy_score !== undefined ? newEmpathy - state.scores.empathy_score : undefined
          const deltaClin = state.scores.clinical_score !== undefined ? newClinical - state.scores.clinical_score : undefined
          nextScores = {
            ...nextScores,
            empathy_score: newEmpathy,
            clinical_score: newClinical,
            dimensions: e.data.dimensions || nextScores.dimensions,
            score_source: e.data.score_source,
            unavailable: e.data.unavailable,
            degraded_review: isDegraded,
            delta_empathy: deltaEmp,
            delta_clinical: deltaClin
          }
        }
      }

      // Process decision events & revisions
      if (e.type === 'decision' && e.data?.route === 'revise') {
        prevScores = { ...state.scores }
      }

      // Process approval
      let approvalAudit = state.approvalAudit
      if (e.type === 'approval' && e.data) {
        approvalAudit = {
          approved_by: e.data.approved_by || 'You',
          approved_at: e.data.approved_at || e.ts,
          scores_at_approval: e.data.scores_at_approval || {},
          content_hash: e.data.content_hash,
          validated_hash: e.data.validated_hash,
          edited: e.data.edited,
          rechecked: e.data.rechecked,
          app_version: e.data.app_version || '3.0.0'
        }
      }

      // Process error
      if (e.type === 'error' && e.data) {
        nextErrorInfo = {
          code: e.data.code || 'error',
          message: e.data.message || e.text,
          retryable: e.data.retryable ?? false
        }
      }

      const derived = derivePhase(nextEvents, state.uiState)

      return {
        ...state,
        events: nextEvents,
        scores: nextScores,
        previousScores: prevScores,
        draft: nextDraft,
        draftVersion: nextDraftVersion,
        activeRunId: e.run_id || state.activeRunId,
        revisionSummaries: nextRevisionSummaries,
        approvalAudit,
        errorInfo: nextErrorInfo,
        phase: derived
      }
    }

    case 'BATCH_EVENTS': {
      let current = state
      for (const ev of action.events) {
        current = protocolReducer(current, { type: 'ADD_EVENT', event: ev })
      }
      return current
    }

    case 'APPEND_TOKEN': {
      return {
        ...state,
        streamingTokenBuffer: state.streamingTokenBuffer + action.token
      }
    }

    case 'CLEAR_TOKEN_BUFFER': {
      return {
        ...state,
        streamingTokenBuffer: ''
      }
    }

    case 'SET_DRAFT': {
      return {
        ...state,
        draft: action.draft,
        streamingTokenBuffer: '', // Clear token buffer on canonical draft arrival
        draftVersion: action.version || state.draftVersion
      }
    }

    case 'SET_SNAPSHOT': {
      const snap = action.snapshot || {}
      return {
        ...state,
        draft: snap.current_draft || state.draft,
        draftVersion: snap.current_version || state.draftVersion,
        userIntent: snap.user_intent || state.userIntent,
        scores: {
          ...state.scores,
          safety_score: snap.safety_score,
          empathy_score: snap.empathy_score,
          clinical_score: snap.clinical_score,
          safety_checks: snap.safety_checks,
          score_source: snap.score_source || (snap.unverified ? 'unavailable' : state.scores.score_source),
          unavailable: snap.unavailable ?? (snap.unverified ? true : state.scores.unavailable),
          unverified: snap.unverified ?? state.scores.unverified
        },
        approvalAudit: snap.approval_audit || state.approvalAudit
      }
    }

    case 'SET_UI_MODE': {
      const nextUI = { ...state.uiState, mode: action.mode }
      return {
        ...state,
        uiState: nextUI,
        phase: derivePhase(state.events, nextUI)
      }
    }

    case 'TOGGLE_UNDER_THE_HOOD': {
      const toggled = !state.uiState.underTheHood
      try {
        localStorage.setItem('cerina_under_the_hood', toggled ? 'true' : 'false')
      } catch (_) {}
      return {
        ...state,
        uiState: { ...state.uiState, underTheHood: toggled }
      }
    }

    case 'SET_TIMELINE_FILTER': {
      return {
        ...state,
        uiState: {
          ...state.uiState,
          timelineFilter: action.filter,
          selectedAgentFilter: action.agent
        }
      }
    }

    case 'SET_CARE_PANEL': {
      return {
        ...state,
        careResources: action.careResources,
        phase: 'care_panel'
      }
    }

    case 'SET_ERROR': {
      return {
        ...state,
        errorInfo: { code: action.code, message: action.message, retryable: action.retryable },
        phase: action.code === 'quota_exceeded' ? 'quota_exhausted' : state.phase
      }
    }

    case 'SET_REPLAY_MODE': {
      return {
        ...state,
        uiState: {
          ...state.uiState,
          isReplay: action.isReplay
        }
      }
    }

    case 'RESET': {
      return {
        ...initialReducerState,
        uiState: {
          ...initialUIState,
          underTheHood: state.uiState.underTheHood
        }
      }
    }

    default:
      return state
  }
}
