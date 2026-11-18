import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RotateCcw, RefreshCw, HeartHandshake, Phone, Globe, ExternalLink } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  onReset?: () => void
  fallbackTitle?: string
  fallbackDescription?: string
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console only, never show stack trace in UI
    console.error('ErrorBoundary caught unhandled error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleStartAgain = () => {
    this.setState({ hasError: false })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.href = '/'
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="max-w-2xl mx-auto my-6 p-6 sm:p-8 rounded-2xl bg-[#FFFDF9] border border-[#E8DFC8] shadow-md space-y-6 text-[#18221E]"
        >
          {/* Header */}
          <div className="flex items-start gap-3.5 pb-4 border-b border-[#E8DFC8]">
            <div className="p-2.5 rounded-xl bg-[#F5EDE0] text-[#8C4A26] shrink-0 mt-0.5">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-serif text-xl sm:text-2xl font-medium text-[#2C211A]">
                {this.props.fallbackTitle || 'Something went wrong on our side'}
              </h2>
              <p className="text-xs sm:text-sm text-[#55635C] mt-1 leading-relaxed">
                {this.props.fallbackDescription ||
                  'We encountered an unexpected problem. Your draft progress is saved locally if you were working on an exercise.'}
              </p>
            </div>
          </div>

          {/* Action buttons: Reload & Start again */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#244F3B] hover:bg-[#1B3D2E] text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload page</span>
            </button>

            <button
              type="button"
              onClick={this.handleStartAgain}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#D5C9B5] text-xs sm:text-sm font-medium text-[#55635C] hover:bg-[#F5EDE0] hover:text-[#18221E] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Start again</span>
            </button>
          </div>

          {/* STATIC Crisis Help Block (0 data dependencies, 0 state) */}
          <div className="pt-4 border-t border-[#E8DFC8] space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8C4A26]">
              <HeartHandshake className="w-4 h-4" />
              <span>Immediate Support & Crisis Lines</span>
            </div>
            <p className="text-xs text-[#55635C]">
              If you or someone you know is in crisis or distress, free and confidential support is available 24/7:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              {/* US */}
              <div className="p-3 rounded-lg bg-white border border-[#E8DFC8] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#2C211A]">United States</p>
                  <p className="text-[11px] text-[#7A6A5E]">988 Suicide & Crisis Lifeline</p>
                </div>
                <a
                  href="tel:988"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#8C4A26] text-white font-semibold hover:bg-[#733B1E] transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  <span>988</span>
                </a>
              </div>

              {/* India */}
              <div className="p-3 rounded-lg bg-white border border-[#E8DFC8] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#2C211A]">India</p>
                  <p className="text-[11px] text-[#7A6A5E]">Tele-MANAS</p>
                </div>
                <a
                  href="tel:14416"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#8C4A26] text-white font-semibold hover:bg-[#733B1E] transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  <span>14416</span>
                </a>
              </div>

              {/* UK & Ireland */}
              <div className="p-3 rounded-lg bg-white border border-[#E8DFC8] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#2C211A]">UK & Ireland</p>
                  <p className="text-[11px] text-[#7A6A5E]">Samaritans</p>
                </div>
                <a
                  href="tel:116123"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#8C4A26] text-white font-semibold hover:bg-[#733B1E] transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  <span>116 123</span>
                </a>
              </div>

              {/* Global */}
              <div className="p-3 rounded-lg bg-white border border-[#E8DFC8] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#2C211A]">Worldwide</p>
                  <p className="text-[11px] text-[#7A6A5E]">Find A Helpline (130+ countries)</p>
                </div>
                <a
                  href="https://findahelpline.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#8C4A26] text-[#8C4A26] font-semibold hover:bg-[#F5EDE0] transition-colors"
                >
                  <Globe className="w-3 h-3" />
                  <span>Browse</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
