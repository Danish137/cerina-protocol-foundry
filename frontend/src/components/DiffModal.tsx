import * as Dialog from '@radix-ui/react-dialog'
import { X, CheckCircle2 } from 'lucide-react'
import * as Diff from 'diff'

interface DiffModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  originalDraft: string
  editedDraft: string
}

export default function DiffModal({
  isOpen,
  onOpenChange,
  originalDraft,
  editedDraft,
}: DiffModalProps) {
  const diffParts = Diff.diffWordsWithSpace(originalDraft || '', editedDraft || '')

  let additions = 0
  let deletions = 0
  diffParts.forEach((part) => {
    if (part.added) additions += part.value.trim().split(/\s+/).filter(Boolean).length
    if (part.removed) deletions += part.value.trim().split(/\s+/).filter(Boolean).length
  })

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] bg-white border border-[#E8E4DA] rounded-2xl shadow-2xl z-50 flex flex-col focus:outline-none animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="p-5 border-b border-[#E8E4DA] flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Dialog.Title className="text-base font-serif font-bold text-[#18221E]">
                  What changed
                </Dialog.Title>
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    +{additions} words
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                    −{deletions} words
                  </span>
                </div>
              </div>
              <p className="text-xs text-[#55635C] mt-0.5">
                Comparison against the AI-generated draft baseline
              </p>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7E8F87] hover:text-[#18221E] hover:bg-[#F2EFE8] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable Diff View Container (inline word-level readable highlights) */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Clinical draft line diff"
            className="flex-1 overflow-y-auto p-6 text-xs sm:text-sm leading-relaxed font-sans select-text focus:outline-none scrollbar-thin"
          >
            {additions === 0 && deletions === 0 ? (
              <div className="py-12 px-4 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-[#EBF3EE] text-[#244F3B] flex items-center justify-center mx-auto border border-[#C2DBCB]">
                  <CheckCircle2 className="w-5 h-5 text-[#244F3B]" />
                </div>
                <h4 className="text-sm font-semibold text-[#18221E]">Identical to baseline</h4>
                <p className="text-xs text-[#55635C] max-w-sm mx-auto">
                  No textual additions or deletions found compared to the baseline draft.
                </p>
              </div>
            ) : (
              <div className="whitespace-pre-wrap font-sans text-[#3A4A41] leading-relaxed">
                {diffParts.map((part, idx) => {
                  if (part.added) {
                    return (
                      <span
                        key={idx}
                        className="bg-[#EBF3EE] text-[#1B3D2E] px-1 py-0.5 rounded font-medium border border-[#C2DBCB]"
                      >
                        {part.value}
                      </span>
                    )
                  }
                  if (part.removed) {
                    return (
                      <span
                        key={idx}
                        className="bg-[#FDF2F2] text-[#9B2C2C] px-1 py-0.5 rounded line-through opacity-75 border border-[#F5C6C6]"
                      >
                        {part.value}
                      </span>
                    )
                  }
                  return (
                    <span key={idx}>
                      {part.value}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#F0ECE3] bg-[#FAF8F5] rounded-b-2xl flex items-center justify-between text-xs text-[#55635C] shrink-0">
            <span>Green represents additions · Red with strikethrough represents removals</span>
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-4 py-1.5 rounded-lg bg-[#244F3B] text-white font-medium hover:bg-[#1B3D2E] transition-colors"
              >
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
