export type Phase =
  | 'idle'
  | 'generating'
  | 'review'
  | 'editing'
  | 'approving'
  | 'approved'
  | 'care_panel'
  | 'quota_exhausted'

export type EventType =
  | 'node_start'
  | 'node_end'
  | 'token'
  | 'message'
  | 'draft'
  | 'score'
  | 'decision'
  | 'checkpoint'
  | 'human_action'
  | 'approval'
  | 'run_end'
  | 'error'

export type EventSeverity = 'info' | 'warning' | 'major' | 'critical'

export interface ProtocolEvent {
  session_id: string
  seq: number
  run_id: string
  run_kind: 'initial' | 'revision' | 'recheck' | 'human_revision' | 'approval'
  draft_version: number
  agent: 'Drafter' | 'SafetyGuardian' | 'ClinicalCritic' | 'Supervisor' | 'Human' | 'System'
  type: EventType
  to_agent?: string
  severity: EventSeverity
  text: string
  data: Record<string, any>
  ts: string
}

export interface StoredSession {
  id: string
  token: string
  intent: string
  status: string
  updated_at: string
  review_depth?: 'standard' | 'thorough'
  draft?: string
}

export interface ScoreData {
  safety_score?: number
  safety_checks?: Record<string, boolean>
  passed_checks?: number
  total_checks?: number
  empathy_score?: number
  clinical_score?: number
  dimensions?: Record<string, { score: number; rationale: string }>
  score_source?: 'llm' | 'retry' | 'unavailable'
  unavailable?: boolean
  delta_safety?: number
  delta_empathy?: number
  delta_clinical?: number
}

export interface RevisionSummaryItem {
  change: string
  responding_to: string
}

export interface ApprovalAudit {
  approved_by: string
  approved_at: string
  scores_at_approval: {
    safety?: number
    empathy?: number
    clinical?: number
  }
  content_hash?: string
  validated_hash?: string
  edited?: boolean
  rechecked?: boolean
}

export type ValidationStatus = 'none' | 'checking' | 'passed' | 'failed' | 'stale'

export interface StepConfig {
  number: number
  title: string
  subtitle: string
  state: 'completed' | 'current' | 'upcoming'
}

export interface ReviewerSuggestion {
  id: string
  agentId?: string
  agent?: string
  agentLabel?: string
  message?: string
  text?: string
  priority?: 'info' | 'warning' | 'critical'
  severity?: 'suggestion' | 'warning' | 'critical'
  createdAt?: string
  isAddressed?: boolean
  isDismissed?: boolean
}

export interface AgentActivity {
  id?: string
  agent: string
  action: string
  timestamp: string
  priority: 'info' | 'warning' | 'critical'
}

export interface ProtocolState {
  session_id: string
  user_intent: string
  current_draft?: string
  current_version?: number
  draft_history?: any[]
  safety_score?: number
  empathy_score?: number
  clinical_score?: number
  safety_checks?: Record<string, boolean>
  agent_notes?: any[]
  status?: string
  active_agent?: string
  max_iterations?: number
  iteration_count?: number
  validated_hash?: string
  human_approved?: boolean
  halted?: boolean
  approval_audit?: ApprovalAudit
}

export interface CareResourceRegion {
  country: string
  name: string
  phone: string
  alt_phone?: string
  text?: string
  website: string
  hours: string
}

export interface CareResources {
  region: CareResourceRegion
  fallback: {
    name: string
    website: string
    description?: string
  }
  all_regions?: Record<string, CareResourceRegion>
}

export interface CapacityStatus {
  daily_budget: number
  calls_used: number
  remaining_calls: number
  remaining_runs_estimate: number
  resets_at: string
  exhausted: boolean
}

export type NodeStatus = 'idle' | 'working' | 'done' | 'concern' | 'waiting'

export interface PipelineNodeState {
  id: 'drafter' | 'safety' | 'critic' | 'supervisor' | 'human'
  name: string
  status: NodeStatus
  statusLine: string
  metricPill?: string
  durationMs?: number
  startedAt?: number
  waitingSince?: number
}

export interface UIState {
  mode: 'default' | 'editing' | 'approving'
  underTheHood: boolean
  timelineFilter: 'all' | 'concerns' | 'decisions'
  selectedAgentFilter?: string
  isReplay?: boolean
}

export interface ReducerState {
  sessionId: string | null
  sessionToken: string | null
  userIntent: string
  reviewDepth: 'standard' | 'thorough'
  events: ProtocolEvent[]
  draft: string
  streamingTokenBuffer: string
  draftVersion: number
  phase: Phase
  uiState: UIState
  scores: ScoreData
  previousScores?: ScoreData
  activeRunId: string | null
  revisionSummaries: RevisionSummaryItem[]
  approvalAudit?: ApprovalAudit
  careResources?: CareResources
  errorInfo?: { code: string; message: string; retryable: boolean }
}
