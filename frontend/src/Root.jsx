import { useState } from 'react'
import App from './App.jsx'
import Gauntlet from './Gauntlet.jsx'
import { COLORS, FONT } from './tokens.js'

const ROOT_COPY = {
  en: { checkTab: 'Check a message', practiceTab: 'Practice', langEn: 'EN', langTe: 'తె' },
  te: { checkTab: 'సందేశం తనిఖీ', practiceTab: 'ప్రాక్టీస్', langEn: 'EN', langTe: 'తె' },
}

export default function Root() {
  const [tab, setTab] = useState('check')
  const [lang, setLang] = useState('en')
  const t = ROOT_COPY[lang]

  return (
    <div>
      <style>{`
        .root-tab:hover:not(.active) { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
      `}</style>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(20, 27, 43, 0.92)',
          backdropFilter: 'blur(6px)',
          borderBottom: `1px solid ${COLORS.border}`,
          padding: '12px 20px',
        }}
      >
        <div
          style={{
            maxWidth: 860,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 6,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 999,
              padding: 4,
              width: 'fit-content',
            }}
          >
            {(['check', 'practice']).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`root-tab${tab === key ? ' active' : ''}`}
                style={{
                  border: `1px solid ${tab === key ? COLORS.accent : COLORS.border}`,
                  background: tab === key ? COLORS.accent : 'transparent',
                  color: tab === key ? COLORS.bg : COLORS.text,
                  fontFamily: FONT.sans,
                  fontWeight: 600,
                  fontSize: 16,
                  borderRadius: 999,
                  padding: '10px 22px',
                  cursor: 'pointer',
                }}
              >
                {key === 'check' ? t.checkTab : t.practiceTab}
              </button>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 6,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 999,
              padding: 4,
              width: 'fit-content',
            }}
          >
            {['en', 'te'].map((code) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`root-tab${lang === code ? ' active' : ''}`}
                style={{
                  border: `1px solid ${lang === code ? COLORS.accent : COLORS.border}`,
                  background: lang === code ? COLORS.accent : 'transparent',
                  color: lang === code ? COLORS.bg : COLORS.text,
                  fontFamily: FONT.sans,
                  fontWeight: 600,
                  fontSize: 15,
                  borderRadius: 999,
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                {code === 'en' ? t.langEn : t.langTe}
              </button>
            ))}
          </div>
        </div>
      </div>
      {tab === 'check' ? <App /> : <Gauntlet />}
    </div>
  )
}