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
        .root-tab:hover:not(.active) { border-color: ${COLORS.lantern}; color: ${COLORS.lantern}; }
      `}</style>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(250, 248, 243, 0.94)',
          backdropFilter: 'blur(6px)',
          borderBottom: `1px solid ${COLORS.hairline}`,
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
              background: COLORS.bgPanel,
              border: `1px solid ${COLORS.hairline}`,
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
                  border: `1px solid ${tab === key ? COLORS.lantern : COLORS.hairline}`,
                  background: tab === key ? COLORS.lantern : 'transparent',
                  color: COLORS.text,
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
              background: COLORS.bgPanel,
              border: `1px solid ${COLORS.hairline}`,
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
                  border: `1px solid ${lang === code ? COLORS.lantern : COLORS.hairline}`,
                  background: lang === code ? COLORS.lantern : 'transparent',
                  color: COLORS.text,
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