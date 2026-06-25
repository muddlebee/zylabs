import { api } from '../api'
import type { SessionDetail } from '../types'

/** Poll until report is ready or session reaches a terminal state. */
export async function pollSessionUntilReady(
  sessionId: string,
  maxAttempts = 30,
  intervalMs = 500,
): Promise<SessionDetail | null> {
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const detail = await api.getSession(sessionId)
      if (
        detail.report ||
        detail.status === 'completed' ||
        detail.status === 'failed' ||
        attempt >= maxAttempts
      ) {
        return detail
      }
    } catch {
      if (attempt >= maxAttempts) return null
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return null
}
