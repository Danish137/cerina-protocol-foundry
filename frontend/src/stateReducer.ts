import { ProtocolState, Phase, ValidationStatus } from './types'

export interface AppState {
  protocolState: ProtocolState | null
  activeSessionId: string | null
  uiMode: 'idle' | 'generating' | 'review' | 'editing' | 'approving' | 'approved'
  editedDraft: string
  initialDraftBeforeEdit: string
  validationStatus: ValidationStatus
  lastValidatedHash: string | null
  approvalTime?: string
  addressedSuggestions: Record<string, boolean>
  dismissedSuggestions: Record<string, boolean>
  hasOptimisticStart: boolean
}

export type AppAction =
  | { type: 'START_CREATE'; sessionId: string; intent: string }
  | { type: 'CREATE_FAILED' }
  | { type: 'APPLY_SNAPSHOT'; state: ProtocolState }
  | { type: 'ENTER_EDIT' }
  | { type: 'DISCARD_EDIT' }
  | { type: 'UPDATE_EDITED_DRAFT'; draft: string }
  | { type: 'START_VALIDATING' }
  | { type: 'VALIDATION_SUCCESS'; hash: string; safetyScore?: number; empathyScore?: number; clinicalScore?: number }
  | { type: 'VALIDATION_FAILED' }
  | { type: 'START_APPROVING' }
  | { type: 'APPROVE_SUCCESS'; time: string }
  | { type: 'APPROVE_FAILED' }
  | { type: 'TOGGLE_ADDRESSED'; id: string }
  | { type: 'DISMISS_SUGGESTION'; id: string }
  | { type: 'RESET' }

export function derivePhase(
  serverState: ProtocolState | null,
  uiMode: AppState['uiMode']
): Phase {
  if (!serverState) {
    return uiMode === 'generating' ? 'generating' : 'idle'
  }

  // 1. Terminal approved state
  if (serverState.status === 'completed' || serverState.human_approved || uiMode === 'approved') {
    return 'approved'
  }

  // 2. In-flight approving
  if (uiMode === 'approving') {
    return 'approving'
  }

  // 3. User actively in edit mode
  if (uiMode === 'editing') {
    return 'editing'
  }

  // 4. Halted / awaiting approval gate
  if (
    serverState.halted ||
    serverState.status === 'awaiting_approval' ||
    serverState.status === 'ready_for_review' ||
    serverState.status === 'awaiting_review'
  ) {
    return 'review'
  }

  // 5. In-flight generation (draft may exist while specialists run, or initial skeleton)
  if (
    serverState.status === 'drafting' ||
    serverState.status === 'initializing' ||
    serverState.status === 'evaluating' ||
    uiMode === 'generating' ||
    !serverState.halted
  ) {
    return 'generating'
  }

  return 'idle'
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'START_CREATE': {
      return {
        ...state,
        activeSessionId: action.sessionId,
        uiMode: 'generating',
        hasOptimisticStart: true,
        protocolState: {
          session_id: action.sessionId,
          user_intent: action.intent,
          status: 'initializing',
        },
        editedDraft: '',
        initialDraftBeforeEdit: '',
        validationStatus: 'none',
        lastValidatedHash: null,
      }
    }

    case 'CREATE_FAILED': {
      return {
        ...state,
        uiMode: 'idle',
        hasOptimisticStart: false,
        activeSessionId: null,
        protocolState: null,
      }
    }

    case 'APPLY_SNAPSHOT': {
      const snap = action.state
      const draft = snap.current_draft || ''
      const isApproved = snap.status === 'completed' || snap.human_approved

      let newUiMode = state.uiMode
      if (isApproved) {
        newUiMode = 'approved'
      } else if (state.uiMode === 'generating' && (snap.halted || snap.status === 'awaiting_approval' || snap.status === 'ready_for_review')) {
        newUiMode = 'review'
      }

      return {
        ...state,
        protocolState: snap,
        hasOptimisticStart: false,
        uiMode: newUiMode,
        // Update editedDraft only if not actively editing
        editedDraft: state.uiMode === 'editing' ? state.editedDraft : draft,
        initialDraftBeforeEdit: state.uiMode === 'editing' ? state.initialDraftBeforeEdit : draft,
      }
    }

    case 'ENTER_EDIT': {
      const current = state.protocolState?.current_draft || state.editedDraft || ''
      return {
        ...state,
        uiMode: 'editing',
        editedDraft: current,
        initialDraftBeforeEdit: current,
        validationStatus: state.lastValidatedHash ? 'stale' : 'none',
      }
    }

    case 'DISCARD_EDIT': {
      return {
        ...state,
        uiMode: 'review',
        editedDraft: state.initialDraftBeforeEdit,
        validationStatus: 'none',
      }
    }

    case 'UPDATE_EDITED_DRAFT': {
      const hasChanged = action.draft !== state.initialDraftBeforeEdit
      return {
        ...state,
        editedDraft: action.draft,
        validationStatus: hasChanged ? 'stale' : state.validationStatus,
      }
    }

    case 'START_VALIDATING': {
      return {
        ...state,
        validationStatus: 'checking',
      }
    }

    case 'VALIDATION_SUCCESS': {
      return {
        ...state,
        validationStatus: 'passed',
        lastValidatedHash: action.hash,
        protocolState: state.protocolState
          ? {
              ...state.protocolState,
              safety_score: action.safetyScore ?? state.protocolState.safety_score,
              empathy_score: action.empathyScore ?? state.protocolState.empathy_score,
              clinical_score: action.clinicalScore ?? state.protocolState.clinical_score,
              validated_hash: action.hash,
            }
          : null,
      }
    }

    case 'VALIDATION_FAILED': {
      return {
        ...state,
        validationStatus: 'failed',
      }
    }

    case 'START_APPROVING': {
      return {
        ...state,
        uiMode: 'approving',
      }
    }

    case 'APPROVE_SUCCESS': {
      return {
        ...state,
        uiMode: 'approved',
        approvalTime: action.time,
        validationStatus: 'passed',
        protocolState: state.protocolState
          ? {
              ...state.protocolState,
              status: 'completed',
              human_approved: true,
              halted: false,
            }
          : null,
      }
    }

    case 'APPROVE_FAILED': {
      return {
        ...state,
        uiMode: 'review',
      }
    }

    case 'TOGGLE_ADDRESSED': {
      const current = Boolean(state.addressedSuggestions[action.id])
      const next = { ...state.addressedSuggestions, [action.id]: !current }
      if (state.activeSessionId) {
        try {
          sessionStorage.setItem(`cerina_addressed_${state.activeSessionId}`, JSON.stringify(next))
        } catch (_) {}
      }
      return {
        ...state,
        addressedSuggestions: next,
      }
    }

    case 'DISMISS_SUGGESTION': {
      const next = { ...state.dismissedSuggestions, [action.id]: true }
      if (state.activeSessionId) {
        try {
          sessionStorage.setItem(`cerina_dismissed_${state.activeSessionId}`, JSON.stringify(next))
        } catch (_) {}
      }
      return {
        ...state,
        dismissedSuggestions: next,
      }
    }

    case 'RESET': {
      return {
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
    }

    default:
      return state
  }
}
