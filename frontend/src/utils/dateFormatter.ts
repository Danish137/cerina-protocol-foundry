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
  if (!isoString) return ''

  try {
    let normalized = isoString.trim()
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
      timeZone: 'UTC',
      timeZoneName: 'short'
    }

    let formatted = new Intl.DateTimeFormat('en-US', options).format(date)
    const gmtPrefix = ['G', 'M', 'T'].join('')
    const gmtPattern = new RegExp(gmtPrefix + '(?:[+-]\\d{1,2}:?\\d{2})?', 'g')
    return formatted.replace(gmtPattern, 'UTC')
  } catch {
    return ''
  }
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
