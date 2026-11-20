import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

function BrokenComponent(): JSX.Element {
  throw new Error('Test crash in child component')
}

function SafeComponent(): JSX.Element {
  return <div>Normal child content rendered safely</div>
}

describe('ErrorBoundary', () => {
  let consoleErrorMock: any

  beforeEach(() => {
    // Suppress React error boundary console output in test log
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorMock.mockRestore()
  })

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Normal child content rendered safely')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows plain-language fallback and static crisis hotlines when a child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    )

    // Fallback heading & plain description
    expect(screen.getByText(/Something went wrong on our side/i)).toBeDefined()
    expect(screen.getByText(/unexpected problem/i)).toBeDefined()

    // Action buttons
    expect(screen.getByRole('button', { name: /Reload page/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Start again/i })).toBeDefined()

    // STATIC Crisis block: 988 US, Tele-MANAS India, Samaritans UK/IE, findahelpline.com
    expect(screen.getByText(/Immediate Support & Crisis Lines/i)).toBeDefined()
    expect(screen.getByText(/988 Suicide & Crisis Lifeline/i)).toBeDefined()
    expect(screen.getByText(/Tele-MANAS/i)).toBeDefined()
    expect(screen.getByText(/Samaritans/i)).toBeDefined()
    expect(screen.getByText(/Find A Helpline/i)).toBeDefined()

    // Console was called, but UI contains no stack trace
    expect(consoleErrorMock).toHaveBeenCalled()
    expect(screen.queryByText(/Test crash in child component/i)).toBeNull()
  })

  it('accepts custom fallbackTitle and fallbackDescription', () => {
    render(
      <ErrorBoundary
        fallbackTitle="Custom Error Title"
        fallbackDescription="Custom error explanation"
      >
        <BrokenComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Custom Error Title')).toBeDefined()
    expect(screen.getByText('Custom error explanation')).toBeDefined()
  })
})
