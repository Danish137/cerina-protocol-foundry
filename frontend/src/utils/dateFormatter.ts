/**
 * Canonical Date & Time Formatter (C1)
 * Displays user's local time WITH timezone abbreviation.
 * Example: "Oct 14, 2026, 10:57 AM IST"
 * No raw ISO strings or microseconds user-facing.
 */

export function formatLocalDateTime(isoString?: string | null): string {
  if (!isoString) return ''

  try {
    let normalized = isoString.trim()
    // Tolerantly parse naive ISO strings from old sessions as UTC
    if (!normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized += 'Z'
    }
    const date = new Date(normalized)
    if (isNaN(date.getTime())) return ''

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }

    return new Intl.DateTimeFormat(undefined, options).format(date)
  } catch {
    return ''
  }
}

export function formatPdfDateTime(isoString?: string | null): string {
  // Use the exact same local-time formatting the UI uses (no UTC/GMT label)
  return formatLocalDateTime(isoString)
}

export function formatLocalTimeOnly(isoString?: string | null): string {
  if (!isoString) return ''

  try {
    let normalized = isoString.trim()
    if (!normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized += 'Z'
    }
    const date = new Date(normalized)
    if (isNaN(date.getTime())) return ''

    const options: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }

    return new Intl.DateTimeFormat(undefined, options).format(date)
  } catch {
    return ''
  }
}

/**
 * Relative time formatter (Item B7)
 * Rules:
 * - "just now" for < 5 seconds
 * - "Xs ago" for < 60 seconds
 * - "Xm ago" for < 60 minutes
 * - "Xh ago" for < 24 hours
 * - Formatted date (e.g. "Nov 16") for >= 24 hours
 * The output "772m ago" must never appear.
 */
export function formatRelativeTime(isoString?: string | null, nowMs?: number): string {
  if (!isoString) return ''

  try {
    let normalized = isoString.trim()
    if (!normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized += 'Z'
    }
    const date = new Date(normalized)
    const timeMs = date.getTime()
    if (isNaN(timeMs)) return ''

    const now = nowMs !== undefined ? nowMs : Date.now()
    const diffSec = Math.max(0, Math.floor((now - timeMs) / 1000))

    if (diffSec < 5) return 'just now'
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`

    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  } catch {
    return ''
  }
}

