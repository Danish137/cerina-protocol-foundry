import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CarePanel from './CarePanel'

describe('CarePanel Regression Tests', () => {
  it('renders cleanly when resources is an empty object {} (reproduction case)', () => {
    const { container } = render(
      <CarePanel
        resources={{} as any}
        onStartNew={vi.fn()}
      />
    )
    expect(screen.getByText(/Support Resources & Crisis Help/i)).toBeDefined()
    expect(screen.getByText(/Hotline/i)).toBeDefined()
    expect(container.querySelector('div[role="alert"]')).toBeNull()
  })

  it('renders cleanly when resources is undefined', () => {
    render(
      <CarePanel
        resources={undefined}
        onStartNew={vi.fn()}
      />
    )
    expect(screen.getByText(/Support Resources & Crisis Help/i)).toBeDefined()
    expect(screen.getByText(/Hotline/i)).toBeDefined()
  })

  it('renders cleanly when resources is null', () => {
    render(
      <CarePanel
        resources={null as any}
        onStartNew={vi.fn()}
      />
    )
    expect(screen.getByText(/Support Resources & Crisis Help/i)).toBeDefined()
    expect(screen.getByText(/Hotline/i)).toBeDefined()
  })

  it('renders cleanly with partial backend payload (e.g. only fallback, missing region)', () => {
    const partialPayload = {
      fallback: {
        name: 'Find A Helpline Custom',
        website: 'https://findahelpline.com',
        description: 'Custom global support'
      }
    }
    render(
      <CarePanel
        resources={partialPayload as any}
        onStartNew={vi.fn()}
      />
    )
    expect(screen.getByText(/Support Resources & Crisis Help/i)).toBeDefined()
    expect(screen.getByText(/Find A Helpline Custom/i)).toBeDefined()
  })

  it('renders cleanly with full backend payload', () => {
    const fullPayload = {
      region: {
        country: 'India',
        name: 'Tele-MANAS',
        phone: '14416',
        hours: '24/7'
      },
      all_regions: {
        IN: {
          country: 'India',
          name: 'Tele-MANAS',
          phone: '14416',
          hours: '24/7'
        },
        US: {
          country: 'United States',
          name: '988 Suicide & Crisis Lifeline',
          phone: '988',
          hours: '24/7'
        }
      },
      fallback: {
        name: 'Find A Helpline',
        website: 'https://findahelpline.com',
        description: 'Worldwide crisis lines'
      }
    }
    render(
      <CarePanel
        resources={fullPayload as any}
        onStartNew={vi.fn()}
      />
    )
    expect(screen.getByText(/Support Resources & Crisis Help/i)).toBeDefined()
    expect(screen.getByText(/Tele-MANAS/i)).toBeDefined()
  })
})
