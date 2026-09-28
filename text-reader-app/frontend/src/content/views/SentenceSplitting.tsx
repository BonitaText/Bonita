import { useRef } from 'react'
import { List } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

/**
 * Props for the SentenceSplitting component.
 *
 * Controls sentence splitting on the page. Mirrors {@link PhraseBolding}'s
 * shape: a toggle button plus an inline popup for configuring how
 * aggressively paragraphs get split.
 */
interface SentenceSplittingProps {
  open: boolean

  /**
   * Called on hover-in (while the tool is enabled) to request the popup open.
   * Independent of the enable/disable click.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close.
   */
  onHide: () => void
}

/**
 * SentenceSplitting
 *
 * Dock button that toggles sentence splitting on the host page.
 *
 * Behaviour mirrors {@link PhraseBolding} exactly (see that component's doc
 * comment for the click/hover/popup interaction details) except the slider
 * here controls `settings.splitThresholdPercent` — how dense/complex a
 * paragraph must score before it's split into point form — rather than a
 * keyword count.
 *
 * **Wiring note:** this component only writes the setting. The setting
 * still needs to be read and applied as a cutoff inside
 * `sentenceSplitter.ts`'s scoring step (`scoreParagraph`), which is not
 * done yet — see the accompanying note on `applySentenceSplit`.
 */
export default function SentenceSplitting({ open, onShow, onHide }: SentenceSplittingProps) {
  const { settings, updateSetting } = useSettings()

  /** Whether sentence splitting is currently active. */
  const enabled = settings.sentenceSplitting

  /**
   * Current sensitivity threshold (1–100), defaulting to 50.
   *
   * Semantics to confirm against `paragraphScorer.ts`: higher = more
   * paragraphs qualify as "split", lower = only the densest/most complex
   * paragraphs get split. See the note on {@link applySentenceSplit}'s
   * options for why this isn't wired through to scoring yet.
   */
  const threshold = settings.splitThresholdPercent ?? 50

  /** Pending hide timeout, so leaving the button and re-entering the popup can cancel it. */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = (): void => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const scheduleHide = (): void => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => onHide(), 150)
  }

  return (
    <div
      className="bonita-font-wrapper"
      onMouseEnter={() => {
        if (enabled) {
          cancelHide()
          onShow()
        }
      }}
      onMouseLeave={scheduleHide}
    >
      <button
        className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
        onClick={() => {
          const next = !enabled
          updateSetting('sentenceSplitting', next)
          cancelHide()
          // The mouse is already over the button on click, so onMouseEnter
          // won't fire again on its own — show/hide the popup directly here
          // too, in addition to the hover-based open/close for revisits.
          if (next) onShow()
          else onHide()
        }}
        data-tooltip="Sentence Splitting"
        aria-label="Sentence Splitting"
      >
        <List size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div
          className="bonita-font-popup"
          style={{ minWidth: 176 }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* ── Sensitivity header ── */}
          <div style={{
            padding: '6px 10px 4px',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--bonita-grey)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}>
            <span>Sensitivity</span>
            <span style={{ color: 'var(--bonita-purple-dark)', fontSize: 13 }}>
              {threshold}%
            </span>
          </div>

          {/* ── Sensitivity slider ── */}
          <div style={{ padding: '2px 10px 8px' }}>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={threshold}
              onChange={e => updateSetting('splitThresholdPercent', Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--bonita-purple)',
                cursor: 'pointer',
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--bonita-grey)',
              marginTop: 2,
              opacity: 0.7,
            }}>
              <span>Fewer splits</span>
              <span>More splits</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}