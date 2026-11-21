import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Header from './Header'
import { ToastProvider } from './Toast'

describe('Header AI app modal component', () => {
  it('renders "Use in your AI app" button and opens hosted MCP setup', async () => {
    render(
      <ToastProvider>
        <Header
          phase="idle"
          onNewProtocol={vi.fn()}
        />
      </ToastProvider>
    )

    const triggerBtn = screen.getByRole('button', { name: /Use Cerina in your AI app/i })
    expect(triggerBtn).toBeDefined()
    expect(triggerBtn.textContent).toContain('Use in your AI app')

    // Click trigger to open popover
    fireEvent.click(triggerBtn)

    // Verify modal title and explainer
    expect(screen.getByText('Connect your AI app')).toBeDefined()
    expect(
      screen.getByText(/Connect Claude, Cursor or another AI app to Cerina so you can create exercises from your chat/i)
    ).toBeDefined()

    // Verify hosted endpoint URL is displayed
    expect(screen.getByText('https://cerina-protocol-foundry-production.up.railway.app/mcp')).toBeDefined()

    // Verify setup options
    expect(screen.getByText('JSON Config')).toBeDefined()
    expect(screen.getByText('Direct URL')).toBeDefined()
    expect(screen.getByText('Command Bridge')).toBeDefined()

    // Verify usage notice
    expect(screen.getByText(/Daily allowance: 5 exercise creations per connection/i)).toBeDefined()
    expect(screen.getByText(/Up to 3 revisions per exercise/i)).toBeDefined()

    // Verify absence of outdated local python clone instructions
    expect(screen.queryByText(/Requires Python 3.10\+/i)).toBeNull()
    expect(screen.queryByText(/local backend/i)).toBeNull()
  })
})
