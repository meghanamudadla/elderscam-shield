// Shared design tokens — "Lantern in the Dusk".
// Used by both App.jsx and Gauntlet.jsx so the two views stay visually consistent.

export const COLORS = {
  bg: '#141b2b',
  bgTop: '#1e2a45',
  text: '#f2ede2',
  muted: '#a9b0c3',
  accent: '#e8a33d',
  accentDark: '#d18f2e',
  card: '#1a2336',
  border: '#2a3550',
  scam: '#d3564f',
  suspicious: '#dba53c',
  safe: '#5aa876',
}

export const FONT = {
  serif: "'Fraunces', serif",
  sans: "'Public Sans', 'Noto Sans Telugu', sans-serif",
  mono: "'IBM Plex Mono', monospace",
}

// Shared <style> block contents (pulseGlow keyframe + button hover/active
// states). Injected by both App.jsx and Gauntlet.jsx so interaction states
// are consistent across tabs.
export const PAGE_STYLES = `
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 16px 2px var(--glow-color, #e8a33d); }
    50%      { box-shadow: 0 0 44px 12px var(--glow-color, #e8a33d); }
  }
  .btn-primary:hover { background: #f4b45c; transform: translateY(-1px); }
  .btn-primary:active { transform: translateY(0); background: ${COLORS.accentDark}; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .mic-btn:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .mic-btn:active { transform: scale(0.97); }
  .mic-btn.listening { border-color: ${COLORS.scam}; color: ${COLORS.scam}; animation: pulseGlow 1.4s ease-in-out infinite; }
  .chip:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .chip:active { transform: scale(0.97); }
  .toggle-btn:hover:not(.active) { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .toggle-btn.active { background: ${COLORS.accent}; color: ${COLORS.bg}; border-color: ${COLORS.accent}; }
`
