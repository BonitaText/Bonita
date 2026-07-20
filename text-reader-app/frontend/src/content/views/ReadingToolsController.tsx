import { useReadingTools } from '../hooks/useReadingTools'

/**
 * Mounts inside the siteEnabled && ready gate in App.tsx so
 * useReadingTools' cleanup fires automatically when either
 * condition goes false, mirroring the lifecycle of the tool
 * components it coordinates.
 *
 * Renders a small loading sign inside the dock while an async analysis pass
 * (keyword extraction or the word-simplification dictionary pre-fetch) is
 * running, so the user gets feedback during the wait instead of a frozen dock.
 */
export default function ReadingToolsController() {
  const busy = useReadingTools()

  if (!busy) return null

  return (
    <div className="bonita-loading" role="status" aria-live="polite">
      <span className="bonita-loading-spinner" aria-hidden="true" />
      <span>Working…</span>
    </div>
  )
}
