import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './dateFormatter'

describe('formatRelativeTime', () => {
  const baseTime = new Date('2026-11-17T12:00:00Z').getTime()

  it('renders "just now" for differences under 5 seconds', () => {
    const iso = new Date(baseTime - 3000).toISOString()
    expect(formatRelativeTime(iso, baseTime)).toBe('just now')
  })

  it('renders seconds ago for differences between 5 and 59 seconds', () => {
    const iso = new Date(baseTime - 45000).toISOString()
    expect(formatRelativeTime(iso, baseTime)).toBe('45s ago')
  })

  it('renders minutes ago for differences between 60 seconds and 59 minutes', () => {
    const iso = new Date(baseTime - 25 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso, baseTime)).toBe('25m ago')
  })

  it('renders hours ago for differences between 60 minutes and 23 hours', () => {
    // 772 minutes = 12 hours 52 minutes: MUST show "12h ago", NOT "772m ago"
    const iso772 = new Date(baseTime - 772 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso772, baseTime)).toBe('12h ago')

    const iso5h = new Date(baseTime - 5 * 3600 * 1000).toISOString()
    expect(formatRelativeTime(iso5h, baseTime)).toBe('5h ago')
  })

  it('renders short date for differences >= 24 hours', () => {
    const iso2d = new Date(baseTime - 48 * 3600 * 1000).toISOString()
    const result = formatRelativeTime(iso2d, baseTime)
    expect(result).toMatch(/(15\s+Nov|Nov\s+15)/)
  })

  it('returns empty string for empty or invalid inputs', () => {
    expect(formatRelativeTime('')).toBe('')
    expect(formatRelativeTime(null)).toBe('')
    expect(formatRelativeTime('not-a-date')).toBe('')
  })
})
