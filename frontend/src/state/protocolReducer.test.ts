import { describe, it, expect } from 'vitest'
import { protocolReducer, initialReducerState } from './protocolReducer'

describe('protocolReducer - SET_CARE_PANEL', () => {
  it('handles SET_CARE_PANEL with undefined careResources cleanly', () => {
    const nextState = protocolReducer(initialReducerState, {
      type: 'SET_CARE_PANEL',
      careResources: undefined
    })

    expect(nextState.phase).toBe('care_panel')
    expect(nextState.careResources).toBeUndefined()
  })

  it('handles SET_CARE_PANEL with null careResources cleanly', () => {
    const nextState = protocolReducer(initialReducerState, {
      type: 'SET_CARE_PANEL',
      careResources: null
    })

    expect(nextState.phase).toBe('care_panel')
    expect(nextState.careResources).toBeNull()
  })

  it('handles SET_CARE_PANEL with full payload cleanly', () => {
    const fullPayload = {
      region: { country: 'United States', name: '988', phone: '988' },
      all_regions: { US: { country: 'United States', name: '988', phone: '988' } }
    }
    const nextState = protocolReducer(initialReducerState, {
      type: 'SET_CARE_PANEL',
      careResources: fullPayload
    })

    expect(nextState.phase).toBe('care_panel')
    expect(nextState.careResources).toEqual(fullPayload)
  })
})
