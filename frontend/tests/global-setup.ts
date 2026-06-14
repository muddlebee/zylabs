/**
 * Global setup: ensures a completed research session exists before tests run.
 * Reuses an existing completed session to avoid re-running the pipeline on
 * every test invocation. Writes the session_id to .session.json for all specs.
 */
import fs from 'fs'
import path from 'path'

const API = 'http://localhost:8001'
export const SESSION_FILE = path.join(__dirname, '.session.json')

async function poll(sessionId: string, maxMs = 140_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const res  = await fetch(`${API}/sessions/${sessionId}`)
    const data = await res.json()
    if (data.status === 'completed') return
    if (data.status === 'failed') throw new Error(`Session ${sessionId} failed`)
    await new Promise(r => setTimeout(r, 5_000))
  }
  throw new Error(`Timed out waiting for session ${sessionId}`)
}

export default async function globalSetup() {
  // 1. Check backend is reachable
  try {
    const health = await fetch(`${API}/healthz`)
    const body   = await health.json()
    if (body.status !== 'ok') throw new Error('unhealthy')
  } catch {
    throw new Error(`Backend not reachable at ${API} — start uvicorn first.`)
  }

  // 2. Reuse existing completed session if one exists
  const listRes  = await fetch(`${API}/sessions`)
  const sessions: Array<{ session_id: string; status: string; company_name: string }> = await listRes.json()
  const existing = sessions.find(s => s.status === 'completed')

  if (existing) {
    console.log(`\n[setup] Reusing completed session: ${existing.session_id} (${existing.company_name})`)
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: existing.session_id }))
    return
  }

  // 3. No completed session — create one
  console.log('\n[setup] No completed session found — creating one (this takes ~90s)…')
  const createRes = await fetch(`${API}/sessions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: 'Notion',
      company_url:  'https://notion.so',
      objective:    'Understand their product-led growth motion ahead of an enterprise expansion call',
    }),
  })
  const { session_id } = await createRes.json()

  await fetch(`${API}/sessions/${session_id}/run`, { method: 'POST' })
  console.log(`[setup] Pipeline running for ${session_id}…`)

  await poll(session_id)
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: session_id }))
  console.log(`[setup] Session ready: ${session_id}`)
}
