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
    displayName: 'Protocol Drafter',
    shortName: 'Drafter',
    role: 'CBT Protocol Architect',
    description: 'Designs evidence-based cognitive and behavioral exercise structures'
  },
  SafetyGuardian: {
    displayName: 'Safety Guardian',
    shortName: 'Safety',
    role: 'Contraindication & Risk Audit',
    description: 'Screens protocols against 5 clinical safety rubrics and medical boundaries'
  },
  ClinicalCritic: {
    displayName: 'Clinical Critic',
    shortName: 'Critic',
    role: 'CBT Fidelity & Empathy',
    description: 'Evaluates therapeutic warmth, collaborative empiricism, and clarity'
  },
  Supervisor: {
    displayName: 'Supervisor',
    shortName: 'Supervisor',
    role: 'Quality & Routing Decision',
    description: 'Synthesizes rubric scores to determine human review routing'
  },
  Human: {
    displayName: 'Reviewer (You)',
    shortName: 'You',
    role: 'Final Verification & Approval',
    description: 'Providing final sign-off and practice tailoring'
  },
  System: {
    displayName: 'Cerina Foundry',
    shortName: 'System',
    role: 'Orchestrator',
    description: 'Manages multi-agent workflow checkpoints and execution lifecycle'
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
  idle: 'Ready to design',
  generating: 'Generating protocol',
  review: 'Awaiting your review',
  awaiting_approval: 'Awaiting your review',
  editing: 'Editing draft',
  approving: 'Finalizing approval',
  approved: 'Approved & Locked',
  care_panel: 'Crisis resources active',
  quota_exhausted: 'Daily quota reached',
  error: 'Review needed'
}

export function formatStatusLabel(statusKey?: string): string {
  if (!statusKey) return 'Ready'
  return STATUS_LABELS[statusKey] || statusKey.replace(/_/g, ' ')
}
