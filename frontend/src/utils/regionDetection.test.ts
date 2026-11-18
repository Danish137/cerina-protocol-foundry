import { describe, it, expect } from 'vitest'
import { detectUserRegion, getOrderedRegionKeys } from './regionDetection'

describe('detectUserRegion', () => {
  it('detects India from Asia/Calcutta or Asia/Kolkata timezone', () => {
    expect(detectUserRegion('Asia/Calcutta')).toBe('IN')
    expect(detectUserRegion('Asia/Kolkata')).toBe('IN')
    expect(detectUserRegion(undefined, 'en-IN')).toBe('IN')
  })

  it('detects UK from Europe/London timezone or en-GB locale', () => {
    expect(detectUserRegion('Europe/London')).toBe('GB')
    expect(detectUserRegion(undefined, 'en-GB')).toBe('GB')
  })

  it('detects Ireland from Europe/Dublin timezone or en-IE locale', () => {
    expect(detectUserRegion('Europe/Dublin')).toBe('IE')
    expect(detectUserRegion(undefined, 'en-IE')).toBe('IE')
  })

  it('detects US from American timezones or en-US locale', () => {
    expect(detectUserRegion('America/New_York')).toBe('US')
    expect(detectUserRegion('America/Los_Angeles')).toBe('US')
    expect(detectUserRegion('America/Chicago')).toBe('US')
    expect(detectUserRegion(undefined, 'en-US')).toBe('US')
  })

  it('falls back to US for unknown timezone and locale', () => {
    expect(detectUserRegion('Antarctica/Troll', 'xx-YY')).toBe('US')
    expect(detectUserRegion('', '')).toBe('US')
  })
})

describe('getOrderedRegionKeys', () => {
  it('places detected region first while retaining all other regions', () => {
    const inOrder = getOrderedRegionKeys('IN', ['US', 'IN', 'GB', 'IE'])
    expect(inOrder).toEqual(['IN', 'US', 'GB', 'IE'])
    expect(inOrder[0]).toBe('IN')
    expect(inOrder).toHaveLength(4)

    const gbOrder = getOrderedRegionKeys('GB', ['US', 'IN', 'GB', 'IE'])
    expect(gbOrder).toEqual(['GB', 'US', 'IN', 'IE'])
    expect(gbOrder[0]).toBe('GB')

    const ieOrder = getOrderedRegionKeys('IE', ['US', 'IN', 'GB', 'IE'])
    expect(ieOrder).toEqual(['IE', 'US', 'IN', 'GB'])
    expect(ieOrder[0]).toBe('IE')

    const usOrder = getOrderedRegionKeys('US', ['US', 'IN', 'GB', 'IE'])
    expect(usOrder).toEqual(['US', 'IN', 'GB', 'IE'])
    expect(usOrder[0]).toBe('US')
  })

  it('handles arbitrary available keys gracefully', () => {
    const custom = getOrderedRegionKeys('IN', ['US', 'GB'])
    expect(custom).toEqual(['US', 'GB'])
  })
})
