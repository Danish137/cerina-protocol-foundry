import { useState, useRef, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Copy, Check, PlusCircle, HelpCircle, Code2, X, User, Terminal } from 'lucide-react'
import CompactStepper from './CompactStepper'
import { Phase, StoredSession } from '../types'
import { getRecentSessions } from '../services/sessionStorage'
import { formatStatusLabel } from '../constants/agents'
import { useToast } from './Toast'

interface HeaderProps {
  phase: Phase
  activeAgent?: string
  sessionId?: string
  onNewProtocol: () => void
  onSelectSession?: (session: StoredSession) => void
  onFocusStep?: (stepNumber: number) => void
}

const HOSTED_MCP_URL = 'https://cerina-protocol-foundry-production.up.railway.app/mcp'

const SNIPPET_JSON_CONFIG = `{
  "mcpServers": {
    "cerina": {
      "url": "https://cerina-protocol-foundry-production.up.railway.app/mcp"
    }
  }
}`

const SNIPPET_BRIDGE_CONFIG = `{
  "mcpServers": {
    "cerina": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://cerina-protocol-foundry-production.up.railway.app/mcp"
      ]
    }
  }
}`

export default function Header({
  phase,
  activeAgent,
  sessionId,
  onNewProtocol,
  onSelectSession,
  onFocusStep,
}: HeaderProps) {
  const { showToast } = useToast()
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [selectedSnippetTab, setSelectedSnippetTab] = useState<'url' | 'json' | 'bridge'>('json')
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const [recentSessions, setRecentSessions] = useState<StoredSession[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (avatarMenuOpen) {
      setRecentSessions(getRecentSessions())
    }
  }, [avatarMenuOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAvatarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(HOSTED_MCP_URL)
    setCopiedUrl(true)
    showToast('Endpoint URL copied', 'success')
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleCopySnippet = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSnippet(true)
    showToast('Configuration snippet copied', 'success')
    setTimeout(() => setCopiedSnippet(false), 2000)
  }

  return (
    <header className="h-14 shrink-0 border-b border-[#E8E4DA] bg-[#FAF8F5] sticky top-0 z-40 select-none">
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
              Self-Help Exercises
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
        <div className="flex items-center gap-2 shrink-0">


          {/* Hosted AI App (MCP) Popover */}
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Use Cerina in your AI app"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-[#E8E4DA] bg-white hover:bg-[#F5F2EC] text-[#18221E] transition-colors shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244F3B] cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5 text-[#244F3B] shrink-0" />
                <span className="hidden sm:inline font-sans text-[11px] font-semibold text-[#244F3B]">
                  Use in your AI app
                </span>
                <span className="sm:hidden font-sans text-[11px] font-semibold text-[#244F3B]">
                  AI app
                </span>
              </button>
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={8}
                tabIndex={0}
                aria-label="Connect your AI app"
                className="z-50 w-96 sm:w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl border border-[#E8E4DA] bg-white p-5 shadow-2xl text-xs space-y-4 animate-in fade-in-50 zoom-in-95 focus:outline-none"
              >
                {/* Header */}
                <div className="flex items-start justify-between pb-3 border-b border-[#F0ECE3]">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-[#18221E] text-sm">
                      <Terminal className="w-4 h-4 text-[#244F3B]" />
                      <h4>Connect your AI app</h4>
                    </div>
                    <p className="text-[11px] text-[#55635C] mt-1 leading-relaxed">
                      Connect Claude, Cursor or another AI app to Cerina so you can create exercises from your chat — uses MCP, an open standard.
                    </p>
                  </div>
                  <Popover.Close
                    className="p-1 rounded-md text-[#88978F] hover:text-[#18221E] hover:bg-[#F0ECE3] transition-colors shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </Popover.Close>
                </div>

                {/* Hosted URL Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#18221E]">Cloud MCP Endpoint:</span>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-[10px] font-semibold text-[#244F3B] shadow-2xs transition-colors cursor-pointer"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre
                    tabIndex={0}
                    aria-label="Cloud MCP Endpoint URL"
                    className="p-2.5 bg-[#FAF8F5] rounded-lg border border-[#E8E4DA] font-mono text-[10.5px] text-[#244F3B] overflow-x-auto select-all focus:outline-none focus:ring-1 focus:ring-[#244F3B]"
                  >
                    {HOSTED_MCP_URL}
                  </pre>
                </div>

                {/* Snippets Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#18221E] text-[11px]">Setup snippets:</span>
                    <div className="flex items-center gap-1 bg-[#F0ECE3] p-0.5 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setSelectedSnippetTab('json')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                          selectedSnippetTab === 'json'
                            ? 'bg-white text-[#18221E] shadow-2xs font-semibold'
                            : 'text-[#55635C] hover:text-[#18221E]'
                        }`}
                      >
                        JSON Config
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSnippetTab('url')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                          selectedSnippetTab === 'url'
                            ? 'bg-white text-[#18221E] shadow-2xs font-semibold'
                            : 'text-[#55635C] hover:text-[#18221E]'
                        }`}
                      >
                        Direct URL
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSnippetTab('bridge')}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                          selectedSnippetTab === 'bridge'
                            ? 'bg-white text-[#18221E] shadow-2xs font-semibold'
                            : 'text-[#55635C] hover:text-[#18221E]'
                        }`}
                      >
                        Command Bridge
                      </button>
                    </div>
                  </div>

                  {/* Active Snippet Display */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1 text-[10.5px] text-[#55635C]">
                      <span>
                        {selectedSnippetTab === 'json' && 'Cursor, Claude Desktop (remote), or VS Code:'}
                        {selectedSnippetTab === 'url' && 'Claude Web, Copilot, or apps accepting an MCP URL:'}
                        {selectedSnippetTab === 'bridge' && 'Local fallback bridge using npx mcp-remote:'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopySnippet(
                            selectedSnippetTab === 'json'
                              ? SNIPPET_JSON_CONFIG
                              : selectedSnippetTab === 'url'
                              ? HOSTED_MCP_URL
                              : SNIPPET_BRIDGE_CONFIG
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-[#F5F2EC] border border-[#E8E4DA] text-[10px] font-semibold text-[#244F3B] shadow-2xs transition-colors cursor-pointer"
                      >
                        {copiedSnippet ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy snippet</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre
                      tabIndex={0}
                      aria-label="Configuration setup snippet"
                      className="p-2.5 bg-[#FAF8F5] rounded-lg border border-[#E8E4DA] font-mono text-[10px] text-[#18221E] overflow-x-auto leading-relaxed select-all focus:outline-none focus:ring-1 focus:ring-[#244F3B]"
                    >
                      {selectedSnippetTab === 'json' && SNIPPET_JSON_CONFIG}
                      {selectedSnippetTab === 'url' && HOSTED_MCP_URL}
                      {selectedSnippetTab === 'bridge' && SNIPPET_BRIDGE_CONFIG}
                    </pre>
                  </div>
                </div>

                {/* Abuse and limits notice */}
                <div className="p-2.5 bg-[#F7F5F0] rounded-lg border border-[#E8E4DA] text-[11px] text-[#55635C] space-y-1">
                  <div className="font-semibold text-[#18221E]">Usage and boundaries</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[10.5px]">
                    <li>Daily allowance: 5 exercise creations per connection</li>
                    <li>Up to 3 revisions per exercise</li>
                    <li>Self-help based on CBT principles · Not therapy or medical advice</li>
                  </ul>
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
              <User className="w-4 h-4 text-white" />
            </button>

            {avatarMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] p-2 shadow-xl backdrop-blur-md z-50 text-xs animate-in fade-in slide-in-from-top-1"
              >
                <div className="px-3 py-2 border-b border-[#F0ECE3] mb-1">
                  <p className="font-semibold text-[#18221E]">You</p>
                  <p className="text-[11px] text-[#55635C]">Active Exercise Session</p>
                </div>

                {/* Recent Sessions list (max 5) per B2 */}
                {recentSessions.length > 0 && (
                  <div className="mb-2 border-b border-[#F0ECE3] pb-2">
                    <p className="px-2 py-1 text-[10px] font-semibold text-[#88978F] uppercase tracking-wider">
                      Recent Exercises
                    </p>
                    <div className="space-y-1">
                      {recentSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAvatarMenuOpen(false)
                            onSelectSession?.(s)
                          }}
                          className={`w-full text-left p-2 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer ${
                            s.id === sessionId ? 'bg-[#EBF3EE] text-[#244F3B]' : 'hover:bg-white text-[#18221E]'
                          }`}
                        >
                          <span className="font-medium truncate text-xs">{s.intent || 'Untitled exercise'}</span>
                          <span className="text-[10px] text-[#55635C]">
                            {formatStatusLabel(s.status)} · {new Date(s.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </button>
                      ))}
                    </div>
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
                    <span>Start new exercise</span>
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
                  <span>Cerina documentation</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
