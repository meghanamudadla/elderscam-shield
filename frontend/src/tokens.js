// Shared design tokens — light "Paper Lantern" theme.
// Used by both App.jsx and Gauntlet.jsx so the two views stay visually consistent.

export const COLORS = {
  bg: '#faf8f3', // soft off-white page background (not pure white — avoids a clinical look)
  bgTop: '#fffdf8', // lighter tint at the top of the page gradient
  bgPanel: '#ffffff', // cards/panels: white + hairline + soft drop-shadow
  bgPanelRaised: '#f4f2ec', // textarea + tool buttons, distinct from pure-white panels
  hairline: 'rgba(27, 36, 54, 0.10)',
  cardShadow: '0 4px 24px rgba(27, 36, 54, 0.08)',
  text: '#1b2436', // dark navy primary text
  textMuted: 'rgba(27, 36, 54, 0.60)',
  lantern: '#d9901f', // amber accent (deepened for contrast on white)
  lanternDark: '#a86e12', // amber for text-on-white accents (notes, score)
  danger: '#d3564f', // FRAUD red
  caution: '#dba53c', // suspicious amber
  safe: '#5aa876', // SAFE green
  dangerSoft: 'rgba(211, 86, 79, 0.12)',
  cautionSoft: 'rgba(219, 165, 60, 0.18)',
  safeSoft: 'rgba(90, 168, 118, 0.14)',
}

export const FONT = {
  serif: "'Fraunces', serif",
  sans: "'Public Sans', 'Noto Sans Telugu', sans-serif",
  mono: "'IBM Plex Mono', monospace",
}

// Shared <style> block contents (pulseGlow keyframe + button hover/active
// states). Injected by both App.jsx and Gauntlet.jsx so interaction states
// are consistent across tabs.
// pulseGlow is the light-theme treatment: a soft colored ring that gently
// breathes (6px -> 11px) instead of the old glow-on-dark radial halo.
export const PAGE_STYLES = `
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 6px var(--glow-color, rgba(217, 144, 31, 0.20)); }
    50%      { box-shadow: 0 0 0 11px var(--glow-color, rgba(217, 144, 31, 0.10)); }
  }
  .btn-primary:hover { background: #e8ab4f; transform: translateY(-1px); }
  .btn-primary:active { transform: translateY(0); background: ${COLORS.lanternDark}; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .mic-btn:hover { border-color: ${COLORS.lantern}; color: ${COLORS.lantern}; }
  .mic-btn:active { transform: scale(0.97); }
  .mic-btn.listening { border-color: ${COLORS.danger}; color: ${COLORS.danger}; --glow-color: ${COLORS.dangerSoft}; animation: pulseGlow 1.4s ease-in-out infinite; }
  .chip:hover { border-color: ${COLORS.lantern}; color: ${COLORS.lantern}; }
  .chip:active { transform: scale(0.97); }
  .toggle-btn:hover:not(.active) { border-color: ${COLORS.lantern}; color: ${COLORS.lantern}; }
  .toggle-btn.active { background: ${COLORS.lantern}; color: ${COLORS.text}; border-color: ${COLORS.lantern}; }
`