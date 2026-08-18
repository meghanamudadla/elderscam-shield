import { useEffect, useRef, useState } from 'react'
import { COLORS, FONT, PAGE_STYLES } from './tokens.js'

// ---------------------------------------------------------------------------
// Backend base URL — same convention as App.jsx. Analysis always goes through
// the backend pipeline; the quiz just wraps it as a training exercise.
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// ---------------------------------------------------------------------------
// Bilingual quiz copy.
// ---------------------------------------------------------------------------
const GAUNTLET_COPY = {
  en: {
    langEn: 'EN',
    langTe: 'తె',
    title: 'Scam Practice Gauntlet',
    subtitle: '8 rounds to train your eye — read the message and guess before you check.',
    score: 'Score',
    round: 'Round',
    of: 'of',
    guessPrompt: 'Is this message a scam, suspicious, or safe?',
    guessScam: 'Scam',
    guessSuspicious: 'Suspicious',
    guessSafe: 'Safe',
    analyzing: 'Checking…',
    correct: 'Correct!',
    incorrect: 'Not quite.',
    rightAnswer: 'The right answer was',
    whatShieldSays: 'What Scam Shield says',
    next: 'Next',
    doneTitle: 'Gauntlet complete!',
    doneScore: 'You got',
    doneScoreOf: 'right.',
    encourageHigh: 'Excellent — your scam radar is strong. Keep helping family and neighbours spot these tricks.',
    encourageMid: 'Good effort — every round you practise makes you sharper.',
    encourageLow: 'No worries at all. Scammers are good at confusing people; that is why we practise. Try again when you are ready.',
    playAgain: 'Play again',
    analyzeError: 'Could not reach the backend, so no explanation could be fetched. Still showing the correct answer.',
    verdictScam: 'SCAM',
    verdictSuspicious: 'SUSPICIOUS',
    verdictSafe: 'SAFE',
    redFlagsLabel: 'Red flags we found',
    adviceLabel: 'What to do next',
  },
  te: {
    langEn: 'EN',
    langTe: 'తె',
    title: 'మోసం గుర్తింపు ప్రాక్టీస్',
    subtitle: '8 రౌండ్లు — సందేశం చదివి, తనిఖీ చేసే ముందు మీరే ఊహించండి.',
    score: 'స్కోరు',
    round: 'రౌండ్',
    of: '/',
    guessPrompt: 'ఈ సందేశం మోసమా, అనుమానమా, లేదా సురక్షితమా?',
    guessScam: 'మోసం',
    guessSuspicious: 'అనుమానం',
    guessSafe: 'సురక్షితం',
    analyzing: 'తనిఖీ చేస్తున్నాం…',
    correct: 'సరైన సమాధానం!',
    incorrect: 'సరిగ్గా కాదు.',
    rightAnswer: 'సరైన జవాబు',
    whatShieldSays: 'Scam Shield ఏమి చెబుతుంది',
    next: 'తర్వాత',
    doneTitle: 'ప్రాక్టీస్ పూర్తయింది!',
    doneScore: 'మీరు',
    doneScoreOf: 'సరిగ్గా చెప్పారు.',
    encourageHigh: 'అద్భుతం — మీ మోస గుర్తింపు నైపుణ్యం బాగా ఉంది. కుటుంబం మరియు పొరుగువారికి కూడా సహాయం చేయండి.',
    encourageMid: 'మంచి ప్రయత్నం — ప్రతి రౌండ్ మిమ్మల్ని మరింత నేర్పరిని చేస్తుంది.',
    encourageLow: 'ఏమీ ఇబ్బంది లేదు. మోసగాళ్ళు మనుషులను అయోమయంలో పడేయడంలో నేర్పరులు; అందుకే ప్రాక్టీస్ చేస్తాం. సిద్ధంగా ఉన్నప్పుడు మళ్ళీ ప్రయత్నించండి.',
    playAgain: 'మళ్ళీ ఆడండి',
    analyzeError: 'సర్వర్ కి చేరలేకపోయాం, అందువల్ల వివరణ లభించలేదు. సరైన సమాధానం మాత్రం చూపిస్తున్నాం.',
    verdictScam: 'మోసం',
    verdictSuspicious: 'అనుమానం',
    verdictSafe: 'సురక్షితం',
    redFlagsLabel: 'మేము గుర్తించిన హెచ్చరికలు',
    adviceLabel: 'తర్వాత ఏమి చేయాలి',
  },
}

// ---------------------------------------------------------------------------
// Fixed quiz set: 8 messages — 4 known scams, 4 safe/routine ones — each with
// its known ground-truth verdict. Covers categories beyond the App examples
// (lottery fee, user-triggered OTP, known contact, bank appointment).
// ---------------------------------------------------------------------------
const GAUNTLET_SET = [
  {
    id: 'kyc-block-urgency',
    expectedVerdict: 'scam',
    text: {
      en: 'Your bank account will be blocked in 24 hours! Your KYC has expired. Click this link immediately to update your KYC details and avoid penalty.',
      te: 'మీ బ్యాంక్ ఖాతా 24 గంటల్లో బ్లాక్ అవుతుంది! మీ KYC గడువు ముగిసింది. వెంటనే ఈ లింక్ పై క్లిక్ చేసి మీ KYC నవీకరించండి.',
    },
  },
  {
    id: 'digital-arrest',
    expectedVerdict: 'scam',
    text: {
      en: 'This is CBI officer Sharma. A parcel with drugs was found in your name. You are under digital arrest. Stay on this call, do not hang up, do not tell anyone. Pay the fine immediately or you will be arrested.',
      te: 'ఇది CBI అధికారి శర్మ. మీ పేరు మీద డ్రగ్స్ పార్సెల్ దొరికింది. మీరు డిజిటల్ అరెస్ట్ లో ఉన్నారు. ఫోన్ పెట్టవద్దు, ఎవరికీ చెప్పవద్దు. వెంటనే జరిమానా చెల్లించండి లేదా అరెస్ట్ అవుతారు.',
    },
  },
  {
    id: 'relative-distress',
    expectedVerdict: 'scam',
    text: {
      en: 'Hello father, this is your son. I had an accident and I am in the hospital. Send 50,000 rupees to this account immediately. Do not tell anyone at home.',
      te: 'నాన్నా, ఇది మీ కొడుకు. నాకు యాక్సిడెంట్ అయింది, ఆసుపత్రిలో ఉన్నాను. వెంటనే 50,000 రూపాయలు ఈ ఖాతాకు పంపండి. ఇంట్లో ఎవరికీ చెప్పకండి.',
    },
  },
  {
    id: 'lottery-prize-fee',
    expectedVerdict: 'scam',
    text: {
      en: 'Congratulations! You have won a lottery prize of 25 lakh rupees. To receive your prize, pay a small processing fee and taxes first. Send money now to claim your winnings before the deadline.',
      te: 'అభినందనలు! మీరు 25 లక్షల రూపాయల లాటరీ బహుమతి గెలుచుకున్నారు. బహుమతి పొందడానికి ముందు చిన్న ప్రాసెసింగ్ ఫీజు మరియు పన్నులు చెల్లించండి. గడువు లోపు డబ్బు పంపి మీ బహుమతిని క్లెయిమ్ చేయండి.',
    },
  },
  {
    id: 'routine-bill',
    expectedVerdict: 'safe',
    text: {
      en: 'Your mobile bill of 299 rupees has been generated. Please pay the amount before the due date through the official app to avoid disconnection.',
      te: 'మీ మొబైల్ బిల్లు 299 రూపాయలు జనరేట్ అయింది. డిస్కనెక్షన్ నివారించడానికి గడువు తేదీలోపు అధికారిక యాప్ ద్వారా చెల్లించండి.',
    },
  },
  {
    id: 'user-triggered-otp',
    expectedVerdict: 'safe',
    text: {
      en: 'OTP 482913 is your one time password for the login you just requested on your banking app. Valid for 5 minutes only. Do not share this code with anyone.',
      te: 'OTP 482913 అనేది మీరే ప్రారంభించిన బ్యాంక్ యాప్ లాగిన్ కు సంబంధించిన ఒకేసారి పాస్‌వర్డ్. 5 నిమిషాలకు మాత్రమే చెల్లుతుంది. ఈ కోడ్ ను ఎవరితోనూ పంచుకోవద్దు.',
    },
  },
  {
    id: 'known-contact-routine',
    expectedVerdict: 'safe',
    text: {
      en: 'Hi Aunty, this is Anitha, your neighbour\'s daughter. I will drop by tomorrow afternoon with the vegetables you asked for. Let me know if the time suits you.',
      te: 'నమస్కారం అత్తయ్యా, నేను మీ పక్కింటి అమ్మాయి అనిత. రేపు మధ్యాహ్నం మీరు అడిగిన కూరగాయలు తెచ్చి ఇస్తాను. సమయం సరిపోతుందేమో చెప్పండి.',
    },
  },
  {
    id: 'bank-appointment-call',
    expectedVerdict: 'safe',
    text: {
      en: 'Dear customer, your bank manager will call you tomorrow at 11 am about your new credit card application. For any questions, contact us at the number printed on your card.',
      te: 'ప్రియమైన కస్టమర్, మీ కొత్త క్రెడిట్ కార్డు దరఖాస్తు గురించి రేపు ఉదయం 11 గంటలకు మీ బ్యాంక్ మేనేజర్ మిమ్మల్ని పిలుస్తారు. ప్రశ్నల కోసం మీ కార్డు పైన ఉన్న నంబర్ కు సంప్రదించండి.',
    },
  },
]

const VERDICT_COLOR = {
  scam: COLORS.danger,
  suspicious: COLORS.caution,
  safe: COLORS.safe,
}

const VERDICT_LABEL_KEY = {
  scam: 'verdictScam',
  suspicious: 'verdictSuspicious',
  safe: 'verdictSafe',
}

function shuffle(items) {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export default function Gauntlet() {
  const [lang, setLang] = useState('en')
  const t = GAUNTLET_COPY[lang]
  const [round, setRound] = useState(0) // index into deck
  const [deck, setDeck] = useState(() => shuffle(GAUNTLET_SET))
  const [score, setScore] = useState(0)
  const [guess, setGuess] = useState(null) // null | "scam" | "suspicious" | "safe"
  const [analysis, setAnalysis] = useState(null)
  const [analyzeError, setAnalyzeError] = useState(false)
  const [checking, setChecking] = useState(false)
  const [finished, setFinished] = useState(false)

  // ---- single source of truth for language ---------------------------------
  // `lang` state drives BOTH the /analyze request language (via langRef, used
  // in makeGuess below) and every GAUNTLET_COPY[lang] label (via t) — there
  // is exactly one language value in this component. langRef is a live
  // mirror, re-synced after EVERY render, so no closure can read a stale
  // language, and the displayed message text uses the same live `lang`.
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  })

  const total = deck.length
  const item = deck[round]
  const answered = guess !== null

  const playAgain = () => {
    setDeck(shuffle(GAUNTLET_SET))
    setRound(0)
    setScore(0)
    setGuess(null)
    setAnalysis(null)
    setAnalyzeError(false)
    setFinished(false)
  }

  const makeGuess = async (value) => {
    if (answered || checking) return
    setGuess(value)
    setChecking(true)
    setAnalyzeError(false)
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item.text[langRef.current], language: langRef.current }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setAnalysis(await res.json())
    } catch {
      setAnalyzeError(true)
    } finally {
      setChecking(false)
    }
    if (value === item.expectedVerdict) setScore((s) => s + 1)
  }

  const next = () => {
    setGuess(null)
    setAnalysis(null)
    setAnalyzeError(false)
    if (round + 1 >= total) {
      setFinished(true)
    } else {
      setRound((r) => r + 1)
    }
  }

  const cardStyle = {
    background: COLORS.bgPanel,
    border: `1px solid ${COLORS.hairline}`,
    borderRadius: 20,
    padding: '26px 28px',
    boxShadow: COLORS.cardShadow,
  }

  const pillStyle = {
    border: `1px solid ${COLORS.hairline}`,
    background: 'transparent',
    color: COLORS.text,
    fontFamily: FONT.sans,
    fontWeight: 600,
    fontSize: 15,
    borderRadius: 999,
    padding: '8px 16px',
    cursor: 'pointer',
  }

  // ---- final score screen -------------------------------------------------
  if (finished) {
    const pct = score / total
    const encourage =
      pct >= 0.75 ? t.encourageHigh : pct >= 0.5 ? t.encourageMid : t.encourageLow
    return (
      <main
        style={{
          minHeight: '100vh',
          background: COLORS.bg,
          padding: '28px 20px 60px',
          maxWidth: 860,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <style>{PAGE_STYLES}</style>
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 28, fontWeight: 600 }}>
            {t.doneTitle}
          </h2>
          <p style={{ margin: '10px 0 0', fontSize: 20, color: COLORS.text }}>
            {t.doneScore} {score} {t.doneScoreOf}
          </p>
          <p style={{ margin: '14px 0 0', fontSize: 17, lineHeight: 1.6, color: COLORS.textMuted }}>
            {encourage}
          </p>
          <button
            onClick={playAgain}
            className="btn-primary"
            style={{
              marginTop: 24,
              background: COLORS.lantern,
              color: COLORS.text,
              border: 'none',
              borderRadius: 12,
              padding: '16px 28px',
              fontSize: 18,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t.playAgain}
          </button>
        </section>
      </main>
    )
  }

  const match = guess === item.expectedVerdict
  const guessColor = match ? COLORS.safe : COLORS.danger

  return (
    <main
      style={{
        minHeight: '100vh',
        background: COLORS.bg,
        padding: '28px 20px 60px',
        maxWidth: 860,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      <style>{PAGE_STYLES}</style>
      {/* header row: title + score + language toggle */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 28, fontWeight: 700 }}>
            {t.title}
          </h1>
          <p style={{ margin: '4px 0 0', color: COLORS.textMuted, fontSize: 14 }}>{t.subtitle}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              gap: 6,
              background: COLORS.bgPanel,
              border: `1px solid ${COLORS.hairline}`,
              borderRadius: 999,
              padding: 4,
            }}
          >
            {['en', 'te'].map((code) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                style={{
                  ...pillStyle,
                  ...(lang === code
                    ? { background: COLORS.lantern, color: COLORS.text, borderColor: COLORS.lantern }
                    : {}),
                }}
              >
                {code === 'en' ? t.langEn : t.langTe}
              </button>
            ))}
          </div>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 14,
              color: COLORS.lanternDark,
              background: COLORS.bgPanel,
              border: `1px solid ${COLORS.hairline}`,
              borderRadius: 999,
              padding: '8px 14px',
            }}
          >
            {t.score}: {score}/{total}
          </span>
        </div>
      </header>

      {/* round card */}
      <section style={cardStyle}>
        <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 12, letterSpacing: 1, color: COLORS.textMuted }}>
          {t.round} {round + 1} {t.of} {total}
        </p>

        <div
          style={{
            marginTop: 16,
            background: COLORS.bgPanelRaised,
            border: `1px solid ${COLORS.hairline}`,
            borderRadius: 14,
            padding: 18,
            fontSize: 19,
            lineHeight: 1.6,
            color: COLORS.text,
          }}
        >
          {item.text[lang]}
        </div>

        <p style={{ margin: '18px 0 12px', fontSize: 16, color: COLORS.textMuted }}>{t.guessPrompt}</p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(['safe', 'suspicious', 'scam']).map((value) => (
            <button
              key={value}
              onClick={() => makeGuess(value)}
              disabled={answered || checking}
              className="btn-primary"
              style={{
                flex: 1,
                minWidth: 140,
                background: VERDICT_COLOR[value],
                color: COLORS.text,
                border: 'none',
                borderRadius: 12,
                padding: '16px 20px',
                fontSize: 17,
                fontWeight: 700,
                cursor: answered || checking ? 'not-allowed' : 'pointer',
                opacity: answered && guess !== value ? 0.35 : 1,
              }}
            >
              {checking && guess === value ? t.analyzing : t[`guess${value[0].toUpperCase()}${value.slice(1)}`]}
            </button>
          ))}
        </div>

        {answered && (
          <div style={{ marginTop: 22 }}>
            <p
              style={{
                margin: 0,
                fontFamily: FONT.mono,
                fontSize: 15,
                letterSpacing: 1,
                color: guessColor,
              }}
            >
              {match ? '✓ ' + t.correct : '✗ ' + t.incorrect} — {t.rightAnswer}:{' '}
              {t[VERDICT_LABEL_KEY[item.expectedVerdict]]}
            </p>

            {analyzeError ? (
              <p style={{ margin: '14px 0 0', color: COLORS.danger, fontSize: 15 }}>
                {t.analyzeError}
              </p>
            ) : analysis ? (
              <div style={{ marginTop: 14, background: COLORS.bgPanelRaised, border: `1px solid ${COLORS.hairline}`, borderRadius: 14, padding: 16 }}>
                <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 12, letterSpacing: 1, color: COLORS.textMuted }}>
                  {t.whatShieldSays} — {t[VERDICT_LABEL_KEY[analysis.verdict]]} ({analysis.confidence}%)
                </p>
                <p style={{ margin: '12px 0 0', fontSize: 16, lineHeight: 1.6, color: COLORS.text }}>
                  {analysis.reasoning}
                </p>
                {analysis.red_flags.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 12, letterSpacing: 1, color: COLORS.danger }}>
                      {t.redFlagsLabel}
                    </p>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: COLORS.text }}>
                      {analysis.red_flags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.advice.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 12, letterSpacing: 1, color: COLORS.textMuted }}>
                      {t.adviceLabel}
                    </p>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: COLORS.text }}>
                      {analysis.advice.map((adv, i) => (
                        <li key={i}>{adv}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <button
              onClick={next}
              className="btn-primary"
              style={{
                marginTop: 18,
                background: COLORS.lantern,
                color: COLORS.text,
                border: 'none',
                borderRadius: 12,
                padding: '16px 28px',
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t.next}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}