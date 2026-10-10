export type Phase = 'idle' | 'generating' | 'review' | 'editing' | 'approving' | 'approved'

export type ValidationStatus = 'none' | 'stale' | 'checking' | 'passed' | 'failed'

export interface AgentNote {
  agent_id: string
  severity: 'suggestion' | 'warning' | 'critical' | 'info'
  message: string
  created_at?: string
  // Compatibility
  agent_name?: string
  note?: string
  priority?: 'info' | 'warning' | 'critical'
  timestamp?: string
}

export interface ApprovalAudit {
  approved_by: string
  approved_at: string
  scores_at_approval: {
    safety?: number
    empathy?: number
    clinical?: number
  }
  edited: boolean
  validated_hash?: string
  revalidated: boolean
}

export interface ProtocolDraftItem {
  content: string
  version: number
  iteration?: number
  timestamp?: string
  safety_score?: number
  empathy_score?: number
  clinical_score?: number
}

export interface ProtocolState {
  session_id: string
  user_intent: string
  status: string
  current_draft?: string
  draft_history?: ProtocolDraftItem[]
  current_version?: number
  iteration_count?: number
  max_iterations?: number
  safety_score?: number
  empathy_score?: number
  clinical_score?: number
  safety_checks?: Record<string, boolean>
  halted?: boolean
  human_approved?: boolean
  human_edits?: string
  active_agent?: string
  agent_notes?: AgentNote[]
  start_time?: string
  last_update?: string
  approval_audit?: ApprovalAudit
  validated_hash?: string
}

export interface ReviewerSuggestion {
  id: string
  agentId: string
  agentLabel: string
  message: string
  severity: 'suggestion' | 'warning' | 'critical'
  createdAt?: string
  isAddressed?: boolean
  isDismissed?: boolean
  // Backward compatibility
  agent?: string
  text?: string
  priority?: string
}

export type StepState = 'completed' | 'current' | 'upcoming'

export interface StepConfig {
  number: number
  title: string
  subtitle: string
  state: StepState
}

export interface UIState {
  mode: 'default' | 'editing' | 'approving'
  hasOptimisticStart: boolean
}

export interface AgentActivity {
  id?: string
  agent: string
  action: string
  timestamp: string
  reasoning?: string
  priority?: 'info' | 'warning' | 'critical'
}
