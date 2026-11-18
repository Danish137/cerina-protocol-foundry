export type RegionKey = 'US' | 'IN' | 'GB' | 'IE'

export const SUPPORTED_REGION_KEYS: RegionKey[] = ['US', 'IN', 'GB', 'IE']

export function detectUserRegion(timeZone?: string, locale?: string): RegionKey {
  let tz = timeZone
  let loc = locale

  // When neither parameter is supplied, infer from browser environment
  if (tz === undefined && loc === undefined) {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch (_) {}
    }
    if (typeof navigator !== 'undefined') {
      loc = navigator.language
    }
  }

  tz = (tz || '').toLowerCase()
  loc = (loc || '').toLowerCase()

  // 1. Timezone checks (highest precision for physical location)
  if (tz) {
    if (tz.includes('calcutta') || tz.includes('kolkata') || tz.includes('asia/colombo')) {
      return 'IN'
    }
    if (tz.includes('london') || tz.includes('europe/belfast')) {
      return 'GB'
    }
    if (tz.includes('dublin')) {
      return 'IE'
    }
    if (
      tz.includes('america/') ||
      tz.includes('us/') ||
      tz.includes('honolulu') ||
      tz.includes('anchorage')
    ) {
      return 'US'
    }
  }

  // 2. Locale checks (secondary)
  if (loc) {
    if (
      loc.endsWith('-in') ||
      loc === 'in' ||
      loc.startsWith('hi') ||
      loc.startsWith('ta') ||
      loc.startsWith('te') ||
      loc.startsWith('bn')
    ) {
      return 'IN'
    }
    if (loc.endsWith('-gb') || loc.endsWith('-uk') || loc === 'en-gb') {
      return 'GB'
    }
    if (loc.endsWith('-ie') || loc === 'en-ie' || loc === 'ga-ie') {
      return 'IE'
    }
    if (loc.endsWith('-us') || loc === 'en-us') {
      return 'US'
    }
  }

  // Default fallback
  return 'US'
}

/**
 * Returns ordered list of region keys with the preferred region first,
 * followed by all other available regions. All regions remain selectable.
 */
export function getOrderedRegionKeys(
  preferredKey: RegionKey = 'US',
  availableKeys: string[] = SUPPORTED_REGION_KEYS
): string[] {
  const result: string[] = []
  if (availableKeys.includes(preferredKey)) {
    result.push(preferredKey)
  }
  for (const k of availableKeys) {
    if (!result.includes(k)) {
      result.push(k)
    }
  }
  return result
}
