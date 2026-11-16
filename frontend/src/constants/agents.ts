/**
 * AGENTS Registry and Status Labels Map
 * Provides human-readable display names, roles, and status strings across the entire application.
 */

export interface AgentMeta {
  displayName: string
  shortName: string
  role: string
  description: string
}

export const AGENTS: Record<string, AgentMeta> = {
  Drafter: {
    displayName: 'Exercise Drafter',
    shortName: 'Drafter',
    role: 'Writes initial steps',
    description: 'Designs step-by-step cognitive and behavioral exercises'
  },
  SafetyGuardian: {
    displayName: 'Safety Check',
    shortName: 'Safety',
    role: 'Screens boundaries & safety',
    description: 'Screens exercises against 5 safety checks and health boundaries'
  },
  ClinicalCritic: {
    displayName: 'Quality Reviewer',
    shortName: 'Quality',
    role: 'Tone, clarity & guidance',
    description: 'Evaluates supportive tone, clarity, and practical guidance'
  },
  Supervisor: {
    displayName: 'Supervisor',
    shortName: 'Supervisor',
    role: "Decides if it's ready",
    description: 'Synthesizes review scores to prepare exercise for your review'
  },
  Human: {
    displayName: 'You',
    shortName: 'You',
    role: 'Review, edit & approve',
    description: 'Read, modify anything you like, and approve'
  },
  System: {
    displayName: 'Cerina',
    shortName: 'System',
    role: 'Orchestrator',
    description: 'Manages exercise workflow checkpoints and review pipeline'
  }
}

export function getAgentDisplayName(agentKey?: string): string {
  if (!agentKey) return 'Agent'
  return AGENTS[agentKey]?.displayName || agentKey
}

export function getAgentShortName(agentKey?: string): string {
  if (!agentKey) return 'Agent'
  return AGENTS[agentKey]?.shortName || agentKey
}

export const STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  generating: 'Creating exercise',
  review: 'Ready for your review',
  awaiting_approval: 'Ready for your review',
  editing: "You're editing",
  approving: 'Finalizing approval',
  approved: 'Approved & Saved',
  care_panel: 'Support resources active',
  quota_exhausted: 'Daily quota reached',
  error: 'Review needed'
}

export function formatStatusLabel(statusKey?: string): string {
  if (!statusKey) return 'Ready'
  return STATUS_LABELS[statusKey] || statusKey.replace(/_/g, ' ')
}
