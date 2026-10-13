import { StoredSession } from '../types'

const SESSIONS_KEY = 'cerina_recent_sessions'

export function getRecentSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('Error reading recent sessions:', err)
    return []
  }
}

export function saveSession(session: StoredSession): void {
  try {
    // Also remove legacy key if present
    localStorage.removeItem('cerina_active_session_id')

    const recents = getRecentSessions()
    const filtered = recents.filter((s) => s.id !== session.id)
    const updated = [session, ...filtered].slice(0, 5) // Keep max 5 (B2)
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated))
  } catch (err) {
    console.error('Error saving session:', err)
  }
}

export function getSession(sessionId: string): StoredSession | undefined {
  return getRecentSessions().find((s) => s.id === sessionId)
}

export function updateSessionStatus(sessionId: string, status: string, draft?: string): void {
  const existing = getSession(sessionId)
  if (existing) {
    saveSession({
      ...existing,
      status,
      draft: draft || existing.draft,
      updated_at: new Date().toISOString()
    })
  }
}

export function getAutoResumeSession(): StoredSession | null {
  const recents = getRecentSessions()
  if (recents.length === 0) return null

  const latest = recents[0]
  // Approved sessions don't auto-open (B2)
  if (latest.status === 'approved') return null

  // Auto-resume only unfinished sessions (< 24h)
  const ageMs = Date.now() - new Date(latest.updated_at).getTime()
  if (ageMs < 24 * 60 * 60 * 1000) {
    return latest
  }
  return null
}
