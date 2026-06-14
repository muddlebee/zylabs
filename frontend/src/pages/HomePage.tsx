import { useEffect, useState } from 'react'
import SessionForm from '../components/SessionForm'
import SessionList from '../components/SessionList'
import { api } from '../api'
import type { Session } from '../types'

export default function HomePage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    api.listSessions()
      .then(data => setSessions(data.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="mb-12">
        <p className="text-xs font-semibold tracking-widest text-accent uppercase mb-3">
          Sales Intelligence
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-ink leading-tight mb-4">
          Know your prospect<br />
          <span className="italic">before you walk in.</span>
        </h1>
        <p className="text-ink-3 text-base max-w-lg">
          Enter a company and your meeting objective. Our AI pipeline researches,
          analyses, and delivers a structured briefing — ready in minutes.
        </p>
      </div>

      {/* Create form */}
      <div className="bg-surface border border-c-border rounded-xl p-6 mb-12">
        <h2 className="text-sm font-semibold text-ink-2 mb-5 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent-light flex items-center justify-center text-accent text-xs font-bold">+</span>
          New Research Session
        </h2>
        <SessionForm />
      </div>

      {/* Session history */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold tracking-widest text-ink-3 uppercase">
            Recent Sessions
          </h2>
          {sessions.length > 0 && (
            <span className="text-xs text-ink-3">{sessions.length} total</span>
          )}
        </div>

        {error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-c-red">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-ink-3 underline mt-2"
            >
              Retry
            </button>
          </div>
        ) : (
          <SessionList sessions={sessions} loading={loading} />
        )}
      </div>
    </div>
  )
}
