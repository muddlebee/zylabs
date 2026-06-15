import { Routes, Route, Link } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SessionDetailPage from './pages/SessionDetailPage'

function Navbar() {
  return (
    <header className="sticky top-0 z-50 bg-surface border-b border-c-border-sub">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-14 py-3 flex items-center">
        <Link to="/" className="flex items-center gap-2 sm:gap-2.5 no-underline min-w-0">
          <span className="font-serif italic text-xl text-ink leading-none">Zylabs</span>
          <span className="text-[10px] sm:text-xs font-medium text-ink-3 tracking-[0.2em] uppercase border-l border-c-border pl-2 sm:pl-2.5 leading-tight">
            Research Copilot
          </span>
        </Link>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}
