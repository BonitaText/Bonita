import { useReadingTools } from '../hooks/useReadingTools'

/**
 * Mounts inside the siteEnabled && ready gate in App.tsx so
 * useReadingTools' cleanup fires automatically when either
 * condition goes false, mirroring the lifecycle of the tool
 * components it coordinates.
 */
export default function ReadingToolsController() {
  useReadingTools()
  return null
}