import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import { normalizeModelText } from '../utils/text'

const REPORT_COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children }) => <ol>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ children }) => (
    <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
  ),
}

const CHAT_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  code: ({ children }) => (
    <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
  ),
  h3: ({ children }) => <h3 className="font-semibold text-ink mt-2 mb-1">{children}</h3>,
}

interface Props {
  content: string
  variant?: 'report' | 'chat'
}

export default function Markdown({ content, variant = 'report' }: Props) {
  const components = variant === 'chat' ? CHAT_COMPONENTS : REPORT_COMPONENTS
  return (
    <ReactMarkdown components={components}>
      {normalizeModelText(content)}
    </ReactMarkdown>
  )
}
