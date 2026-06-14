import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import type { ChatMessage } from '../types'

interface Props { sessionId: string }

export default function ChatPanel({ sessionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [fetched, setFetched]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getChatHistory(sessionId)
      .then(setMessages)
      .catch(() => {}) // graceful — history is optional
      .finally(() => setFetched(true))
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(msgOverride?: string) {
    const msg = (msgOverride ?? input).trim()
    if (!msg || loading) return
    setInput('')
    setError('')

    const userMsg: ChatMessage = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const reply = await api.sendChat(sessionId, msg)
      setMessages(prev => [...prev, reply])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
      setMessages(prev => prev.slice(0, -1)) // remove optimistic user msg
      setInput(msg) // restore input
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    send()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (!fetched) {
    return (
      <div className="space-y-3 pt-4">
        <div className="h-10 skeleton w-3/4 ml-auto" />
        <div className="h-16 skeleton w-5/6" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Intro */}
      {messages.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-sm text-ink-3">
            Ask a follow-up question about the research.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-3">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 border border-c-border rounded-full text-ink-3 hover:border-accent hover:text-accent transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 py-2 max-h-96">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user' ? 'chat-user' : 'chat-assistant'
              }`}
            >
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <div className="prose-chat">
                  <ReactMarkdown
                    components={{
                      p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
                      em:     ({ children }) => <em className="italic">{children}</em>,
                      ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                      ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                      li:     ({ children }) => <li className="leading-snug">{children}</li>,
                      code:   ({ children }) => <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                      h3:     ({ children }) => <h3 className="font-semibold text-ink mt-2 mb-1">{children}</h3>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="chat-assistant px-4 py-2.5">
              <ThinkingDots />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-c-red text-center">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-3 pt-3 border-t border-c-border-sub">
        <textarea
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up…"
          disabled={loading}
          className="flex-1 px-3 py-2.5 text-sm bg-surface border border-c-border rounded-lg resize-none
            focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors
            disabled:opacity-50 placeholder-ink-3"
          style={{ minHeight: '40px', maxHeight: '120px', overflowY: 'auto' }}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="px-4 py-2 bg-ink text-bg text-sm font-medium rounded-lg
            hover:bg-ink-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-4">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-ink-3 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

const SUGGESTIONS = [
  'What are the key risks to watch?',
  'How should I open the conversation?',
  'Who are the decision makers likely to be?',
]
