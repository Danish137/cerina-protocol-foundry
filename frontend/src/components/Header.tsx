import { useState, useRef, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ExternalLink, Copy, Check, PlusCircle, HelpCircle, Code2, X } from 'lucide-react'
import CompactStepper from './CompactStepper'
import { Phase } from '../types'
import { useToast } from './Toast'

interface HeaderProps {
  phase: Phase
  activeAgent?: string
  sessionId?: string
  onNewProtocol: () => void
  onFocusStep?: (stepNumber: number) => void
}

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "cerina-foundry": {
      "command": "python",
      "args": [
        "/path/to/Cerina-Protocol-Foundary/mcp_server/server.py"
      ],
      "env": {
        "BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}`

export default function Header({
  phase,
  activeAgent,
  sessionId,
  onNewProtocol,
  onFocusStep,
}: HeaderProps) {
  const { showToast } = useToast()
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [copiedSession, setCopiedSession] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAvatarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCopySessionId = () => {
    if (!sessionId) return
    navigator.clipboard.writeText(sessionId)
    setCopiedSession(true)
    showToast('Session ID copied to clipboard', 'success')
    setTimeout(() => setCopiedSession(false), 2000)
  }

  const handleCopyMcpConfig = () => {
    navigator.clipboard.writeText(MCP_CONFIG_SNIPPET)
    setCopiedConfig(true)
    showToast('MCP configuration copied', 'success')
    setTimeout(() => setCopiedConfig(false), 2000)
  }

  return (
    <header className="h-14 shrink-0 border-b border-[#E8E4DA] bg-[#FAF8F5]/95 backdrop-blur-md sticky top-0 z-40 select-none">
      <div className="max-w-[1600px] h-full mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#244F3B] flex items-center justify-center text-[#FAF8F5] shadow-xs">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path
                d="M12 2C6.5 2 2 6.5 2 12c0 3.5 2 6.5 5 8 .5-4 3.5-7 7-7 3.5 0 6.5 3 7 7 3-1.5 5-4.5 5-8 0-5.5-4.5-10-10-10z"
                fill="#FAF8F5"
                stroke="none"
                opacity="0.9"
              />
              <path d="M12 22V12" stroke="#244F3B" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-base sm:text-lg font-bold tracking-tight text-[#18221E] hidden sm:inline">
              CERINA
            </span>
            <span className="text-[#D8D2C4] font-light hidden sm:inline">|</span>
            <span className="text-xs font-sans text-[#55635C] font-medium tracking-normal hidden md:inline">
              Protocol Foundry
            </span>
          </div>
        </div>

        {/* Center: Compact Stepper */}
        <div className="flex-1 max-w-xl flex justify-center min-w-0">
          <CompactStepper
            phase={phase}
            activeAgent={activeAgent}
            onStepClick={onFocusStep}
          />
        </div>

        {/* Right: Actions & User Avatar */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* MCP Popover (Section 10) */}
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Model Context Protocol configuration"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-[#E8E4DA] bg-white hover:bg-[#F5F2EC] text-[#18221E] transition-colors shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5 text-[#244F3B]" />
                <span className="font-mono text-[11px] font-semibold text-[#244F3B]">MCP</span>
              </button>
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={8}
                className="z-50 w-84 sm:w-96 rounded-xl border border-[#E8E4DA] bg-white p-4 shadow-xl text-xs space-y-3 animate-in fade-in-50 zoom-in-95"
              >
                <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
                  <div>
                    <h4 className="font-semibold text-[#18221E] text-sm">Claude Desktop MCP</h4>
                    <p className="text-[11px] text-[#55635C]">Add to your claude_desktop_config.json</p>
                  </div>
                  <Popover.Close
                    className="p-1 rounded-md text-[#88978F] hover:text-[#18221E] hover:bg-[#F0ECE3] transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </Popover.Close>
                </div>

                <div className="relative">
                  <pre className="p-3 bg-[#FAF8F5] rounded-lg border border-[#E8E4DA] font-mono text-[10.5px] text-[#18221E] overflow-x-auto leading-relaxed select-all">
                    {MCP_CONFIG_SNIPPET}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyMcpConfig}
                    className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-[10px] font-medium text-[#244F3B] shadow-2xs transition-colors"
                  >
                    {copiedConfig ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-[#88978F]">Requires Python 3.10+</span>
                  <a
                    href="https://github.com/Danish137/cerina-protocol-foundry/blob/main/mcp_server/TEST_MCP.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#244F3B] font-medium hover:underline"
                  >
                    <span>Setup documentation</span>
                    <ExternalLink className="w-3 h-3 text-[#7E8F87]" />
                  </a>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* User Profile Avatar with Dropdown Menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setAvatarMenuOpen((prev) => !prev)}
              aria-haspopup="true"
              aria-expanded={avatarMenuOpen}
              aria-label="Session options and profile menu"
              className="w-8 h-8 rounded-full bg-[#244F3B] hover:bg-[#1B3D2E] text-white flex items-center justify-center text-xs font-semibold shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] transition-transform active:scale-95 cursor-pointer"
            >
              DA
            </button>

            {avatarMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] p-2 shadow-xl backdrop-blur-md z-50 text-xs animate-in fade-in slide-in-from-top-1"
              >
                <div className="px-3 py-2 border-b border-[#F0ECE3] mb-1">
                  <p className="font-semibold text-[#18221E]">Clinical Reviewer</p>
                  <p className="text-[11px] text-[#55635C] font-mono">Danish Akhtar (Lead)</p>
                </div>

                {/* Session ID in avatar menu per Section 10 */}
                {sessionId && (
                  <div className="p-2 bg-white rounded-lg border border-[#E8E4DA] mb-2">
                    <div className="flex items-center justify-between text-[11px] text-[#55635C] mb-1">
                      <span>Active Session:</span>
                      <button
                        type="button"
                        onClick={handleCopySessionId}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-[#244F3B] font-semibold hover:underline cursor-pointer"
                      >
                        {copiedSession ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy ID</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="font-mono text-[10px] text-[#18221E] truncate bg-[#FAF8F5] px-2 py-1 rounded border border-[#F0ECE3] select-all">
                      {sessionId}
                    </p>
                  </div>
                )}

                {/* Hide "Start new protocol" when idle per Section 10 */}
                {phase !== 'idle' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAvatarMenuOpen(false)
                      onNewProtocol()
                    }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[#18221E] hover:bg-white transition-colors font-medium cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-[#244F3B]" />
                    <span>Start new protocol</span>
                  </button>
                )}

                <a
                  href="https://github.com/Danish137/cerina-protocol-foundry"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[#55635C] hover:bg-white transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#7E8F87]" />
                  <span>Protocol Foundry docs</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
