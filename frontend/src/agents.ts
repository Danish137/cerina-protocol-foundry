import {
  FileText,
  ShieldCheck,
  MessageSquareQuote,
  Bot,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'

export interface AgentConfig {
  id: string
  label: string
  role: string
  description: string
  icon: LucideIcon
}

export const AGENTS: Record<string, AgentConfig> = {
  drafter: {
    id: 'drafter',
    label: 'Clinical Drafter',
    role: 'Exercise Authoring',
    description: 'Structures evidence-based CBT exercises using clinical frameworks.',
    icon: FileText,
  },
  safety_guardian: {
    id: 'safety_guardian',
    label: 'Safety Guardian',
    role: 'Risk & Contraindication Screening',
    description: 'Evaluates protocols against medical advice and self-harm boundaries.',
    icon: ShieldCheck,
  },
  clinical_critic: {
    id: 'clinical_critic',
    label: 'Clinical Critic',
    role: 'Therapeutic Empathy & Fidelity',
    description: 'Evaluates therapeutic warmth, clinical realism, and pacing.',
    icon: MessageSquareQuote,
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisor',
    role: 'Quality Orchestration',
    description: 'Synthesizes quality metrics and governs approval gates.',
    icon: Bot,
  },
  human: {
    id: 'human',
    label: 'Human Reviewer',
    role: 'Human Gatekeeper',
    description: 'User verification gate for final protocol delivery.',
    icon: UserCheck,
  },
}

export const AGENTS_LIST: AgentConfig[] = [
  AGENTS.drafter,
  AGENTS.safety_guardian,
  AGENTS.clinical_critic,
  AGENTS.supervisor,
  AGENTS.human,
]

export function normalizeAgentId(rawName?: string | null): string {
  if (!rawName) return 'drafter'
  const lower = rawName.toLowerCase().replace(/[\s_-]/g, '')
  if (lower.includes('safe')) return 'safety_guardian'
  if (lower.includes('critic') || lower.includes('clinical')) return 'clinical_critic'
  if (lower.includes('draft')) return 'drafter'
  if (lower.includes('super')) return 'supervisor'
  if (lower.includes('human')) return 'human'
  return 'drafter'
}

export function getAgent(rawName?: string | null): AgentConfig {
  const id = normalizeAgentId(rawName)
  return AGENTS[id] || AGENTS.drafter
}
