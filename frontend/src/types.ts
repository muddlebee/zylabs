export interface Session {
  session_id: string
  company_name: string
  company_url: string
  objective: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
}

export interface Source {
  id: string
  url: string
  title: string
  snippet: string
  tier: 1 | 2 | 3
  retrieved_at: string
}

export interface SectionFinding {
  section: string
  content: string
  source_ids: string[]
  confidence: number
}

export interface WorkflowError {
  node: string
  message: string
  recoverable: boolean
}

export interface Report {
  session_id: string
  company_name: string
  generated_at: string
  sections: Record<string, SectionFinding>
  sources: Source[]
  financials: Record<string, string | number | string[] | null>
  meta: {
    quality_score: number
    revisions: number
    company_type: string
    retrieval_unavailable?: boolean
    stopped_at?: 'plan' | null
    errors: WorkflowError[]
  }
}

export interface SessionDetail extends Session {
  report: Report | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export interface StreamEvent {
  node: string
  status: string
  errors?: WorkflowError[]
}

export interface WorkflowProgress {
  session_id: string
  status: Session['status']
  events: StreamEvent[]
}
