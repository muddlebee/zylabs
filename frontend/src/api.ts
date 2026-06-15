import type { Session, SessionDetail, ChatMessage, WorkflowProgress } from './types'

// In production (Vercel), point at the Railway backend. In dev, Vite proxies /api → localhost:8001.
const BASE = import.meta.env.VITE_API_URL ?? '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  createSession(data: { company_name: string; company_url: string; objective: string }) {
    return request<{ session_id: string; status: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  listSessions() {
    return request<Session[]>('/sessions')
  },

  getSession(id: string) {
    return request<SessionDetail>(`/sessions/${id}`)
  },

  runSession(id: string) {
    return request<{ session_id: string; status: string }>(`/sessions/${id}/run`, {
      method: 'POST',
    })
  },

  sendChat(id: string, message: string) {
    return request<ChatMessage>(`/sessions/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
  },

  getChatHistory(id: string) {
    return request<ChatMessage[]>(`/sessions/${id}/chat`)
  },

  getProgress(id: string) {
    return request<WorkflowProgress>(`/sessions/${id}/progress`)
  },

  streamUrl(id: string, after = 0) {
    const suffix = after > 0 ? `?after=${after}` : ''
    return `${BASE}/sessions/${id}/stream${suffix}`
  },
}
