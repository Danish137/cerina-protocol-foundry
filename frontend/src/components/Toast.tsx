import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  actionLabel?: string
  onAction?: () => void
  duration?: number
}

interface ToastContextValue {
  showToast: (message: string, type?: 'success' | 'error' | 'info', options?: { actionLabel?: string; onAction?: () => void; duration?: number }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'info' = 'info',
      options?: { actionLabel?: string; onAction?: () => void; duration?: number }
    ) => {
      const id = Math.random().toString(36).substring(2, 9)
      const duration = options?.duration ?? (type === 'error' ? 0 : 4000)

      const newToast: ToastMessage = {
        id,
        type,
        message,
        actionLabel: options?.actionLabel ?? (type === 'error' ? 'Retry' : undefined),
        onAction: options?.onAction,
        duration,
      }

      // Max 1 visible per Section 2
      setToasts([newToast])

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id)
        }, duration)
      }
    },
    [removeToast]
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container: below header (top-[72px] right-6), never overlapping header */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-[72px] right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-top-2 text-xs leading-relaxed ${
              toast.type === 'success'
                ? 'bg-[#FAF8F5]/95 border-[#CDE0D4] text-[#18221E] shadow-[#244F3B]/5'
                : toast.type === 'error'
                ? 'bg-[#FFF8F8]/95 border-[#F5C6C6] text-[#9B2C2C] shadow-red-900/5'
                : 'bg-[#FAF8F5]/95 border-[#E8E4DA] text-[#18221E] shadow-stone-900/5'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-[#244F3B]" />
              )}
              {toast.type === 'error' && (
                <AlertCircle className="w-4 h-4 text-[#9B2C2C]" />
              )}
              {toast.type === 'info' && (
                <Info className="w-4 h-4 text-[#8C5921]" />
              )}
            </div>

            <div className="flex-1 min-w-0 font-medium">
              <p>{toast.message}</p>
              {toast.actionLabel && toast.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onAction?.()
                    removeToast(toast.id)
                  }}
                  className="mt-1.5 font-bold underline hover:opacity-80 transition-opacity focus:outline-none"
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-1 rounded-md text-[#88978F] hover:text-[#18221E] hover:bg-[#F0ECE3] transition-colors focus:outline-none focus:ring-1 focus:ring-[#244F3B]"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
