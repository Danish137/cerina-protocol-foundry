import { fetchEventSource } from '@microsoft/fetch-event-source'
import { ProtocolEvent } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export interface SSEClientOptions {
  sessionId: string
  sessionToken: string
  lastEventId?: number
  onEvent: (event: ProtocolEvent) => void
  onToken?: (tokenText: string) => void
  onError?: (err: { code: string; message: string; retryable: boolean }) => void
  onRunEnd?: () => void
}

export class ProtocolStreamClient {
  private abortController: AbortController | null = null
  private highestSeq: number = 0

  constructor(private options: SSEClientOptions) {
    this.highestSeq = options.lastEventId || 0
  }

  public start() {
    this.stop()
    this.abortController = new AbortController()

    // Token transmitted via X-Session-Token header, NOT query parameter
    const url = `${API_BASE_URL}/api/protocols/${this.options.sessionId}/stream?after=${this.highestSeq}`

    fetchEventSource(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'X-Session-Token': this.options.sessionToken,
        ...(this.highestSeq > 0 ? { 'Last-Event-ID': String(this.highestSeq) } : {})
      },
      signal: this.abortController.signal,
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          return // Connection established
        }
        if (response.status === 404) {
          throw new Error('SESSION_NOT_FOUND')
        }
        if (response.status === 429) {
          throw new Error('QUOTA_EXCEEDED')
        }
      },
      onmessage: (msg) => {
        if (!msg.data) return

        // Handle token event
        if (msg.event === 'token') {
          try {
            const data = JSON.parse(msg.data)
            if (this.options.onToken) {
              this.options.onToken(data.text || '')
            }
          } catch (_) {}
          return
        }

        // Handle error event
        if (msg.event === 'error') {
          try {
            const errData = JSON.parse(msg.data)
            if (this.options.onError) {
              this.options.onError({
                code: errData.code || 'error',
                message: errData.message || 'Stream error',
                retryable: errData.retryable ?? false
              })
            }
          } catch (_) {}
          this.stop()
          return
        }

        // Handle run_end
        if (msg.event === 'run_end') {
          if (this.options.onRunEnd) {
            this.options.onRunEnd()
          }
          // Cleanly terminate client stream to prevent auto-reconnection attempts
          this.stop()
          return
        }

        // Standard ProtocolEvent
        try {
          const parsed = JSON.parse(msg.data)
          if (parsed.seq !== undefined) {
            const evt = parsed as ProtocolEvent
            if (evt.seq > 0) {
              this.highestSeq = Math.max(this.highestSeq, evt.seq)
            }
            this.options.onEvent(evt)
          }
        } catch (err) {
          console.error('Error parsing SSE event payload:', err)
        }
      },
      onerror: (err) => {
        console.error('SSE connection error:', err)
        // Fall back to polling /events?after=
        this.fallbackPollEvents()
        if (this.options.onError) {
          this.options.onError({
            code: 'stream_connection_error',
            message: 'Live stream interrupted. Polling activity fallback...',
            retryable: true
          })
        }
      }
    })
  }

  public stop() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  private async fallbackPollEvents() {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/protocols/${this.options.sessionId}/events?after=${this.highestSeq}`,
        {
          headers: {
            'X-Session-Token': this.options.sessionToken
          }
        }
      )
      if (res.ok) {
        const json = await res.json()
        const events = json.events || []
        for (const evt of events) {
          this.highestSeq = Math.max(this.highestSeq, evt.seq)
          this.options.onEvent(evt)
        }
      }
    } catch (err) {
      console.error('Fallback poll error:', err)
    }
  }
}
