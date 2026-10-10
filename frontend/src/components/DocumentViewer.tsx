import React, { useState, useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import * as Diff from 'diff'
import {
  Download,
  Edit3,
  CheckCircle2,
  Clock,
  Sparkles,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Lock,
  FileText,
  GitCompare,
} from 'lucide-react'
import { Phase } from '../types'
import DiffModal from './DiffModal'

interface DocumentViewerProps {
  phase: Phase
  draft: string
  editedDraft: string
  isSafetyCriticRunning?: boolean
  elapsedSeconds?: number
  sessionId?: string
  onDraftChange: (text: string) => void
  onStartEditing: () => void
  onSaveEditsAndApprove: () => void
  onDiscardEdits: () => void
  onExportPdf: () => void
}

export default function DocumentViewer({
  phase,
  draft,
  editedDraft,
  isSafetyCriticRunning = false,
  elapsedSeconds = 0,
  sessionId,
  onDraftChange,
  onStartEditing,
  onSaveEditsAndApprove,
  onDiscardEdits,
  onExportPdf,
}: DocumentViewerProps) {
  // Default to Split view on wide displays >=1536px, Rich Editor otherwise
  const [editorViewMode, setEditorViewMode] = useState<'rich' | 'markdown' | 'split'>(() => {
    return typeof window !== 'undefined' && window.innerWidth >= 1536 ? 'split' : 'rich'
  })
  const [readingProgress, setReadingProgress] = useState(0)
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [restoredSessionAlert, setRestoredSessionAlert] = useState(false)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const splitLeftRef = useRef<HTMLDivElement>(null)
  const splitRightRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)

  const isEditing = phase === 'editing'
  const isApproved = phase === 'approved'
  const hasDraft = Boolean(draft || editedDraft)

  // Rotating stage messages during initial generation when no draft exists
  const rotatingStages = ['Drafting clinical structure…', 'Screening safety guidelines…', 'Evaluating therapeutic empathy…']
  const stageIndex = Math.floor(elapsedSeconds / 3) % rotatingStages.length
  const currentStageText = rotatingStages[stageIndex]

  // Word-level diff calculation
  const wordDiff = useMemo(() => {
    if (!isEditing || !draft) return { added: 0, removed: 0 }
    const parts = Diff.diffWords(draft, editedDraft)
    let added = 0
    let removed = 0
    parts.forEach((p) => {
      if (p.added) added += p.value.trim().split(/\s+/).filter(Boolean).length
      if (p.removed) removed += p.value.trim().split(/\s+/).filter(Boolean).length
    })
    return { added, removed }
  }, [isEditing, draft, editedDraft])

  // Autosave to sessionStorage
  useEffect(() => {
    if (isEditing && sessionId && editedDraft) {
      sessionStorage.setItem(`cerina_autosave_${sessionId}`, editedDraft)
    }
  }, [isEditing, sessionId, editedDraft])

  // Offer restore if autosave exists and differs
  useEffect(() => {
    if (isEditing && sessionId) {
      const saved = sessionStorage.getItem(`cerina_autosave_${sessionId}`)
      if (saved && saved !== draft && saved !== editedDraft) {
        setRestoredSessionAlert(true)
      }
    }
  }, [isEditing, sessionId, draft])

  // Setup TipTap Editor for Rich Text Editing
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Markdown,
    ],
    content: editedDraft || draft || '',
    editorProps: {
      attributes: {
        class: 'prose prose-stone cerina-prose max-w-[68ch] mx-auto min-h-[300px] focus:outline-none text-[17px] leading-[1.7]',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Extract markdown from TipTap storage
      const md = (ed.storage as any).markdown?.getMarkdown() || ed.getText()
      onDraftChange(md)
    },
  })

  // Synchronize TipTap content if external draft changes
  useEffect(() => {
    if (editor && isEditing) {
      const currentMd = (editor.storage as any).markdown?.getMarkdown?.() || ''
      if (currentMd !== editedDraft && editor.isFocused === false) {
        editor.commands.setContent(editedDraft)
      }
    }
  }, [editedDraft, editor, isEditing])

  // Synced scroll in Split View mode
  const handleSplitLeftScroll = () => {
    if (!isSyncingScroll.current && splitLeftRef.current && splitRightRef.current) {
      isSyncingScroll.current = true
      const left = splitLeftRef.current
      const right = splitRightRef.current
      const pct = left.scrollTop / (left.scrollHeight - left.clientHeight || 1)
      right.scrollTop = pct * (right.scrollHeight - right.clientHeight || 1)
      requestAnimationFrame(() => {
        isSyncingScroll.current = false
      })
    }
  }

  const handleSplitRightScroll = () => {
    if (!isSyncingScroll.current && splitLeftRef.current && splitRightRef.current) {
      isSyncingScroll.current = true
      const left = splitLeftRef.current
      const right = splitRightRef.current
      const pct = right.scrollTop / (right.scrollHeight - right.clientHeight || 1)
      left.scrollTop = pct * (left.scrollHeight - left.clientHeight || 1)
      requestAnimationFrame(() => {
        isSyncingScroll.current = false
      })
    }
  }

  // Reading progress tracker on outermost scroller
  const handleOutermostScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const max = el.scrollHeight - el.clientHeight
    if (max > 0) {
      setReadingProgress(Math.min(100, Math.max(0, (el.scrollTop / max) * 100)))
    }
  }

  // Format elapsed time MM:SS
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60)
    const remainder = secs % 60
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
  }

  // Keyboard shortcut listeners (Cmd/Ctrl+S = Save, Esc = Discard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditing) return
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        onSaveEditsAndApprove()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onDiscardEdits()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, onSaveEditsAndApprove, onDiscardEdits])

  // 1. Initial Generating state with NO draft yet
  if (!hasDraft && phase === 'generating') {
    return (
      <div
        tabIndex={0}
        role="region"
        aria-label="Generating protocol draft"
        className="h-full bg-white border border-[#E8E4DA] rounded-2xl p-6 sm:p-8 flex flex-col justify-between overflow-hidden shadow-2xs animate-in fade-in focus:outline-none"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#F0ECE3]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-full bg-[#EBF3EE] text-[#244F3B] animate-spin">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-[#18221E]">
                Designing CBT Protocol…
              </h3>
              <p className="text-xs text-[#55635C]">
                Active stage:{' '}
                <span className="font-semibold text-[#244F3B]">
                  {currentStageText}
                </span>
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1 rounded-full bg-[#FAF8F5] border border-[#E8E4DA] text-[#55635C]">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTime(elapsedSeconds)}</span>
          </div>
        </div>

        {/* Shimmering skeleton bars */}
        <div className="space-y-6 max-w-xl mx-auto w-full my-auto animate-pulse">
          <div className="h-7 bg-[#F0ECE3] rounded-md w-3/4" />
          <div className="space-y-2.5">
            <div className="h-4 bg-[#F5F2EC] rounded w-full" />
            <div className="h-4 bg-[#F5F2EC] rounded w-5/6" />
            <div className="h-4 bg-[#F5F2EC] rounded w-2/3" />
          </div>
          <div className="pt-4 border-t border-[#F0ECE3] space-y-3">
            <div className="h-5 bg-[#F0ECE3] rounded w-1/2" />
            <div className="h-4 bg-[#F5F2EC] rounded w-4/5" />
            <div className="h-4 bg-[#F5F2EC] rounded w-3/4" />
          </div>
        </div>

        <p className="text-center text-xs text-[#7E8F87]">
          Multidisciplinary agents are collaborating. Draft will render immediately upon synthesis.
        </p>
      </div>
    )
  }

  // =========================================================================
  // 2. EDIT MODE: The editor fills the pane height and is the ONLY scroller.
  // =========================================================================
  if (isEditing) {
    return (
      <div className="h-full flex flex-col bg-white border border-[#E8E4DA] rounded-2xl overflow-hidden shadow-2xs">
        {/* Sticky Toolbar in Edit Mode */}
        <div className="px-5 py-3 border-b border-[#E8E4DA] bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm font-bold text-[#18221E]">
              Clinician Editor
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-[#FFF8F0] text-[#8C5921] border border-[#F7E1B5]">
              Editing · unsaved changes {wordDiff.added > 0 || wordDiff.removed > 0 ? `(+${wordDiff.added} −${wordDiff.removed} words)` : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle: [Rich Editor | Markdown | Split] */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] text-xs">
              <button
                type="button"
                onClick={() => setEditorViewMode('rich')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  editorViewMode === 'rich'
                    ? 'bg-white text-[#244F3B] shadow-2xs font-semibold'
                    : 'text-[#55635C] hover:text-[#18221E]'
                }`}
              >
                Rich Text
              </button>
              <button
                type="button"
                onClick={() => setEditorViewMode('markdown')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  editorViewMode === 'markdown'
                    ? 'bg-white text-[#244F3B] shadow-2xs font-semibold'
                    : 'text-[#55635C] hover:text-[#18221E]'
                }`}
              >
                Markdown
              </button>
              <button
                type="button"
                onClick={() => setEditorViewMode('split')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  editorViewMode === 'split'
                    ? 'bg-white text-[#244F3B] shadow-2xs font-semibold'
                    : 'text-[#55635C] hover:text-[#18221E]'
                }`}
              >
                Split
              </button>
            </div>

            {/* Review Changes Button */}
            <button
              type="button"
              onClick={() => setShowDiffModal(true)}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-medium text-[#18221E] transition-colors flex items-center gap-1"
            >
              <GitCompare className="w-3.5 h-3.5 text-[#244F3B]" />
              <span>Diff</span>
            </button>
          </div>
        </div>

        {/* Formatting Toolbar (Acts on selection) */}
        {editor && (editorViewMode === 'rich' || editorViewMode === 'split') && (
          <div className="px-5 py-1.5 bg-[#FAF8F5] border-b border-[#E8E4DA] flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('bold')
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Bold (Selection)"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('italic')
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Italic (Selection)"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('heading', { level: 2 })
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Section Heading H2"
              >
                <Heading2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('heading', { level: 3 })
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Step Heading H3"
              >
                <Heading3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('bulletList')
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Bullet List"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`p-1.5 rounded transition-colors ${
                  editor.isActive('orderedList')
                    ? 'bg-white text-[#244F3B] shadow-2xs border border-[#CDE0D4]'
                    : 'text-[#55635C] hover:bg-white hover:text-[#18221E]'
                }`}
                title="Numbered List"
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-[#7E8F87]">
              <span>Cmd/Ctrl+S = Save</span>
              <span>·</span>
              <span>Esc = Discard</span>
            </div>
          </div>
        )}

        {/* Autosave Restore Alert */}
        {restoredSessionAlert && (
          <div className="px-5 py-2 bg-[#FEF9EE] border-b border-[#F7E1B5] flex items-center justify-between text-xs text-[#8C5921] shrink-0">
            <span>Autosaved draft from previous session detected.</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const saved = sessionStorage.getItem(`cerina_autosave_${sessionId}`)
                  if (saved) onDraftChange(saved)
                  setRestoredSessionAlert(false)
                }}
                className="font-semibold underline hover:text-[#18221E]"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => setRestoredSessionAlert(false)}
                className="text-[#7E8F87] hover:text-[#18221E]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Single Scroll Surface for Edit Mode */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {editorViewMode === 'rich' ? (
            <div
              tabIndex={0}
              role="region"
              aria-label="Rich text editor"
              className="h-full overflow-y-auto p-6 sm:p-8 overscroll-contain focus:outline-none scrollbar-thin"
            >
              <EditorContent editor={editor} />
            </div>
          ) : editorViewMode === 'markdown' ? (
            <textarea
              value={editedDraft}
              onChange={(e) => onDraftChange(e.target.value)}
              tabIndex={0}
              role="region"
              aria-label="Markdown text editor"
              placeholder="CBT Protocol Markdown…"
              className="w-full h-full p-6 sm:p-8 font-mono text-xs sm:text-sm text-[#18221E] leading-relaxed resize-none focus:outline-none scrollbar-thin bg-white"
            />
          ) : (
            /* Split View Mode with Synced Scroll */
            <div className="h-full grid grid-cols-2 divide-x divide-[#E8E4DA]">
              <div
                ref={splitLeftRef}
                onScroll={handleSplitLeftScroll}
                tabIndex={0}
                role="region"
                aria-label="Split editor pane"
                className="h-full overflow-y-auto p-6 overscroll-contain focus:outline-none scrollbar-thin"
              >
                <EditorContent editor={editor} />
              </div>
              <div
                ref={splitRightRef}
                onScroll={handleSplitRightScroll}
                tabIndex={0}
                role="region"
                aria-label="Split preview pane"
                className="h-full overflow-y-auto p-6 bg-[#FAF8F5] overscroll-contain focus:outline-none scrollbar-thin"
              >
                <div className="max-w-[68ch] mx-auto prose prose-stone cerina-prose text-[16px] leading-[1.65]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editedDraft || '*No content*'}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Diff Modal */}
        <DiffModal
          isOpen={showDiffModal}
          onOpenChange={setShowDiffModal}
          originalDraft={draft}
          editedDraft={editedDraft}
        />
      </div>
    )
  }

  // =========================================================================
  // 3. READ-ONLY MODE (Review / Approved / Draft Available)
  // RULE: The scroller is the OUTERMOST element. Card padding is inside.
  // Wheel events work everywhere over center column without dead zones.
  // =========================================================================
  const displayContent = draft || editedDraft || ''

  return (
    <div
      ref={scrollerRef}
      onScroll={handleOutermostScroll}
      tabIndex={0}
      role="region"
      aria-label="Protocol Document"
      className="h-full overflow-y-auto bg-white border border-[#E8E4DA] rounded-2xl shadow-2xs overscroll-contain focus:outline-none scrollbar-thin relative flex flex-col"
    >
      {/* Sticky Document Toolbar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-[#E8E4DA] px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#FAF8F5] border border-[#E8E4DA] flex items-center justify-center text-[#244F3B] shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-serif text-sm font-bold text-[#18221E] truncate">
                CBT Exercise Specification
              </span>
              {isApproved ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#EBF3EE] text-[#244F3B] border border-[#CDE0D4] flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Approved & Locked</span>
                </span>
              ) : isSafetyCriticRunning ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF9EE] text-[#8C5921] border border-[#F7E1B5] flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3 animate-spin" />
                  <span>Review in progress</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FAF8F5] text-[#55635C] border border-[#E8E4DA] flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3 text-[#D4882C]" />
                  <span>Draft v1 · Awaiting approval</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar Secondary Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isApproved && (
            <button
              type="button"
              onClick={onStartEditing}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#F2EFE8] border border-[#E8E4DA] text-xs font-semibold text-[#18221E] transition-colors flex items-center gap-1.5"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#55635C]" />
              <span>Edit draft</span>
            </button>
          )}

          <div className="relative group">
            <button
              type="button"
              onClick={onExportPdf}
              disabled={!isApproved}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isApproved
                  ? 'bg-white hover:bg-[#F2EFE8] text-[#18221E] border-[#E8E4DA] shadow-2xs cursor-pointer'
                  : 'bg-[#FAF8F5] text-[#88978F] border-[#E8E4DA] cursor-not-allowed opacity-60'
              }`}
            >
              {!isApproved && <Lock className="w-3 h-3 text-[#88978F]" />}
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>

            {!isApproved && (
              <div className="absolute right-0 top-full mt-1.5 hidden group-hover:block z-50 pointer-events-none">
                <div className="bg-[#18221E] text-white text-[11px] rounded-lg py-1 px-2.5 whitespace-nowrap shadow-md">
                  Approve protocol to export
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2px Reading Progress Bar under Toolbar */}
      <div className="sticky top-[53px] z-20 w-full h-0.5 bg-transparent overflow-hidden">
        <div
          className="h-full bg-[#244F3B] transition-all duration-75"
          style={{ width: `${readingProgress}%` }}
        />
      </div>

      {/* In-Flight Review Banner (When draft exists but critics still running) */}
      {isSafetyCriticRunning && (
        <div className="mx-6 mt-4 p-3 rounded-xl bg-[#FAF8F5] border border-[#CDE0D4] flex items-center gap-2.5 text-xs text-[#244F3B] shrink-0">
          <Sparkles className="w-4 h-4 text-[#244F3B] animate-spin shrink-0" />
          <span>
            Safety Guardian and Clinical Critic are evaluating this draft. You may read through while checks complete.
          </span>
        </div>
      )}

      {/* Document Prose Body (Capped at 68ch for optimal clinical readability) */}
      <div className="flex-1 p-6 sm:p-10">
        <article className="max-w-[68ch] mx-auto prose prose-stone cerina-prose text-[17px] leading-[1.7] focus:outline-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayContent || '*Waiting for agent draft generation…*'}
          </ReactMarkdown>
        </article>

        {/* Quiet Clinical Disclaimer at bottom of document */}
        <div className="max-w-[68ch] mx-auto mt-12 pt-6 border-t border-[#F0ECE3] text-[12px] text-[#55635C] flex items-center justify-between">
          <span>AI-generated protocol draft for clinician review — not a substitute for professional clinical care.</span>
          <span className="font-mono text-[11px] text-[#55635C]">CERINA CLINICAL FOUNDRY</span>
        </div>
      </div>
    </div>
  )
}
