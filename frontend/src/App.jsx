import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { COLORS, FONT, PAGE_STYLES } from './tokens.js'

// ---------------------------------------------------------------------------
// Backend base URL. In dev, the Vite proxy forwards /api/* -> http://127.0.0.1:8000
// (stripping the /api prefix). Override with VITE_API_BASE for other setups.
// The frontend NEVER talks to the LLM directly — every analysis goes through
// the backend pipeline.
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// ---------------------------------------------------------------------------
// Bilingual copy. Every piece of UI text lives here — nothing is hardcoded
// in the components below.
// ---------------------------------------------------------------------------
const COPY = {
  en: {
    title: 'Scam Shield',
    subtitle: 'Check any message before you trust it — your lantern in the dark of phishing.',
    langEn: 'EN',
    langTe: 'తె',
    statusChecking: 'checking…',
    statusOnline: 'backend online',
    statusOffline: 'backend offline',
    inputPlaceholder:
      'Paste or type a suspicious SMS, WhatsApp message, email, or what someone said to you on a call…',
    analyze: 'Check this message',
    analyzing: 'Checking…',
    mic: 'Speak the message',
    listening: 'Listening… speak now',
    micUnsupported: 'Voice input is not supported in this browser.',
    uploadScreenshot: 'Upload a screenshot',
    readingScreenshot: 'Reading the screenshot…',
    ocrEmpty: "Couldn't find any text in that image — try a clearer screenshot.",
    ocrBadFile: 'Please upload an image file.',
    ocrFailed: 'Something went wrong reading that image. Please try again.',
    examplesLabel: 'Or try an example:',
    examples: [
      { label: 'KYC alert', text: 'Your bank account will be blocked in 24 hours! Your KYC has expired. Click this link immediately to update your KYC details and avoid penalty.' },
      { label: 'Digital arrest', text: 'This is CBI officer Sharma. A parcel with drugs was found in your name. You are under digital arrest. Stay on this call, do not hang up, do not tell anyone. Pay the fine immediately or you will be arrested.' },
      { label: 'Relative in trouble', text: 'Hello father, this is your son. I had an accident and I am in the hospital. Send 50,000 rupees to this account immediately. Do not tell anyone at home.' },
      { label: 'Routine bill', text: 'Your mobile bill of 299 rupees has been generated. Please pay the amount before the due date through the official app to avoid disconnection.' },
    ],
    verdictScam: 'SCAM',
    verdictSuspicious: 'SUSPICIOUS',
    verdictSafe: 'SAFE',
    headlineScam: 'Likely a scam — be very careful.',
    headlineSuspicious: 'Looks suspicious — verify before acting.',
    headlineSafe: 'Looks safe — no red flags found.',
    confidence: 'confidence',
    reasoningLabel: 'Why we think so',
    redFlagsLabel: 'Red flags we found',
    adviceLabel: 'What to do next',
    listen: 'Listen to the explanation',
    listeningLabel: 'Speaking…',
    listenUnsupported: 'Voice output is not supported in this browser.',
    flag: 'Flag this — someone tried this on me too',
    flagged: 'Flagged — thank you for helping others.',
    flagError: 'Could not flag this message. Please try again.',
    communityTitle: 'Recently reported in the community',
    communityEmpty: 'No reports yet — be the first to flag a scam.',
    trendsTitle: 'Community trends this week',
    trendsEmpty: 'No trend data yet — flag a scam to help others see what is circulating.',
    categoryNames: {
      'kyc-block-urgency': 'KYC block scare',
      'otp-upi-phishing': 'OTP/PIN phishing',
      'lottery-prize-fee': 'Lottery prize fee',
      'relative-distress': 'Relative in trouble',
      'fake-delivery-fee': 'Fake delivery fee',
      'guaranteed-investment': 'Fake investment',
      'govt-scheme-processing-fee': 'Govt scheme fee',
      'fake-customer-care': 'Fake customer care',
      'job-advance-fee': 'Job advance fee',
      'digital-arrest': 'Digital arrest',
      'vishing-bank-tax-official': 'Bank/tax vishing',
      'routine-bill': 'Routine bill',
      'user-triggered-otp': 'User-triggered OTP',
      'known-contact-routine': 'Known contact',
      other: 'Other',
    },
    resultError: 'Could not reach the backend. Is the server running? (backend folder: uvicorn app.main:app --reload)',
  },
  te: {
    title: 'Scam Shield',
    subtitle: 'నమ్మకం పెట్టే ముందు ప్రతి సందేశాన్ని తనిఖీ చేయండి — ఫిషింగ్ చీకటిలో మీ దీపం.',
    langEn: 'EN',
    langTe: 'తె',
    statusChecking: 'తనిఖీ…',
    statusOnline: 'సర్వర్ ఆన్‌లైన్',
    statusOffline: 'సర్వర్ ఆఫ్‌లైన్',
    inputPlaceholder:
      'అనుమానాస్పద SMS, WhatsApp సందేశం, ఈమెయిల్ లేదా కాల్ లో ఎవరో మీతో చెప్పినది ఇక్కడ అతికించండి లేదా టైప్ చేయండి…',
    analyze: 'ఈ సందేశం తనిఖీ చేయండి',
    analyzing: 'తనిఖీ చేస్తున్నాం…',
    mic: 'సందేశం మాట్లాడండి',
    listening: 'వింటున్నాం… ఇప్పుడు మాట్లాడండి',
    micUnsupported: 'ఈ బ్రౌజర్ లో వాయిస్ ఇన్‌పుట్ సపోర్ట్ చేయదు.',
    uploadScreenshot: 'స్క్రీన్‌షాట్ అప్‌లోడ్ చేయండి',
    readingScreenshot: 'స్క్రీన్‌షాట్ చదువుతున్నాం…',
    ocrEmpty: 'ఆ చిత్రంలో ఎటువంటి అక్షరాలు కనిపించలేదు — మరింత స్పష్టమైన స్క్రీన్‌షాట్ ప్రయత్నించండి.',
    ocrBadFile: 'దయచేసి చిత్రం (ఇమేజ్) ఫైల్ అప్‌లోడ్ చేయండి.',
    ocrFailed: 'ఆ చిత్రాన్ని చదవడంలో ఏదో సమస్య జరిగింది. మళ్ళీ ప్రయత్నించండి.',
    examplesLabel: 'లేదా ఉదాహరణ ప్రయత్నించండి:',
    examples: [
      { label: 'KYC హెచ్చరిక', text: 'మీ బ్యాంక్ ఖాతా 24 గంటల్లో బ్లాక్ అవుతుంది! మీ KYC గడువు ముగిసింది. వెంటనే ఈ లింక్ పై క్లిక్ చేసి మీ KYC నవీకరించండి.' },
      { label: 'డిజిటల్ అరెస్ట్', text: 'ఇది CBI అధికారి శర్మ. మీ పేరు మీద డ్రగ్స్ పార్సెల్ దొరికింది. మీరు డిజిటల్ అరెస్ట్ లో ఉన్నారు. ఫోన్ పెట్టవద్దు, ఎవరికీ చెప్పవద్దు. వెంటనే జరిమానా చెల్లించండి లేదా అరెస్ట్ అవుతారు.' },
      { label: 'బంధువు ఇబ్బంది', text: 'నాన్నా, ఇది మీ కొడుకు. నాకు యాక్సిడెంట్ అయింది, ఆసుపత్రిలో ఉన్నాను. వెంటనే 50,000 రూపాయలు ఈ ఖాతాకు పంపండి. ఇంట్లో ఎవరికీ చెప్పకండి.' },
      { label: 'సాధారణ బిల్లు', text: 'మీ మొబైల్ బిల్లు 299 రూపాయలు జనరేట్ అయింది. డిస్కనెక్షన్ నివారించడానికి గడువు తేదీలోపు అధికారిక యాప్ ద్వారా చెల్లించండి.' },
    ],
    verdictScam: 'మోసం',
    verdictSuspicious: 'అనుమానం',
    verdictSafe: 'సురక్షితం',
    headlineScam: 'ఇది మోసం అయ్యే అవకాశం ఉంది — చాలా జాగ్రత్తగా ఉండండి.',
    headlineSuspicious: 'అనుమానాస్పదంగా ఉంది — చర్య తీసుకునే ముందు ధృవీకరించండి.',
    headlineSafe: 'సురక్షితంగా కనిపిస్తోంది — ఎటువంటి ప్రమాదం లేదు.',
    confidence: 'విశ్వాసం',
    reasoningLabel: 'మేము ఎందుకు అలా అనుకుంటున్నాము',
    redFlagsLabel: 'మేము గుర్తించిన హెచ్చరికలు',
    adviceLabel: 'తర్వాత ఏమి చేయాలి',
    listen: 'వివరణ వినండి',
    listeningLabel: 'చెబుతున్నాం…',
    listenUnsupported: 'ఈ బ్రౌజర్ లో వాయిస్ అవుట్‌పుట్ సపోర్ట్ చేయదు.',
    flag: 'దీన్ని నివేదించండి — నాకూ ఇలాంటిదే వచ్చింది',
    flagged: 'నివేదించారు — ఇతరులకు సహాయం చేసినందుకు ధన్యవాదాలు.',
    flagError: 'ఈ సందేశాన్ని నివేదించలేకపోయాం. మళ్ళీ ప్రయత్నించండి.',
    communityTitle: 'కమ్యూనిటీలో ఇటీవల నివేదించినవి',
    communityEmpty: 'ఇంకా నివేదికలు లేవు — మోసాన్ని నివేదించే మొదటి వ్యక్తి అవ్వండి.',
    trendsTitle: 'ఈ వారం కమ్యూనిటీ పోకడలు',
    trendsEmpty: 'ఇంకా ట్రెండ్ డేటా లేదు — ప్రచారంలో ఉన్న దానిని ఇతరులకు చూపించడానికి మోసాన్ని నివేదించండి.',
    categoryNames: {
      'kyc-block-urgency': 'KYC బ్లాక్ భయం',
      'otp-upi-phishing': 'OTP/PIN ఫిషింగ్',
      'lottery-prize-fee': 'లాటరీ బహుమతి ఫీజు',
      'relative-distress': 'బంధువు ఇబ్బంది',
      'fake-delivery-fee': 'నకిలీ డెలివరీ ఫీజు',
      'guaranteed-investment': 'నకిలీ పెట్టుబడి',
      'govt-scheme-processing-fee': 'ప్రభుత్వ పథకం ఫీజు',
      'fake-customer-care': 'నకిలీ కస్టమర్ కేర్',
      'job-advance-fee': 'ఉద్యోగ అడ్వాన్స్ ఫీజు',
      'digital-arrest': 'డిజిటల్ అరెస్ట్',
      'vishing-bank-tax-official': 'బ్యాంక్/పన్ను విషింగ్',
      'routine-bill': 'సాధారణ బిల్లు',
      'user-triggered-otp': 'యూజర్ OTP',
      'known-contact-routine': 'తెలిసిన వ్యక్తి',
      other: 'ఇతర',
    },
    resultError: 'సర్వర్ కి చేరలేకపోయాం. సర్వర్ నడుస్తోందా? (backend ఫోల్డర్ లో: uvicorn app.main:app --reload)',
  },
}

// Verdict visual config, keyed by the backend's verdict string.
const VERDICT_STYLE = {
  scam: { color: COLORS.scam, glow: 'rgba(211, 86, 79, 0.16)' },
  suspicious: { color: COLORS.suspicious, glow: 'rgba(219, 165, 60, 0.16)' },
  safe: { color: COLORS.safe, glow: 'rgba(90, 168, 118, 0.16)' },
}

const pageStyles = PAGE_STYLES

export default function App() {
  const [lang, setLang] = useState('en')
  const t = COPY[lang]

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [resultError, setResultError] = useState('')

  const [status, setStatus] = useState('checking')
  const [listening, setListening] = useState(false)
  const [micNote, setMicNote] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [listenNote, setListenNote] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrNote, setOcrNote] = useState('')

  const [flagged, setFlagged] = useState(false)
  const [flagNote, setFlagNote] = useState('')
  const [reports, setReports] = useState([])
  const [summary, setSummary] = useState({ categories: [], total: 0 })

  const recognitionRef = useRef(null)
  const fileInputRef = useRef(null)
  const analyzedTextRef = useRef('')

  // ---- backend health + community feed on mount ---------------------------
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/health`)
        setStatus(res.ok ? 'online' : 'offline')
      } catch {
        setStatus('offline')
      }
    })()
    loadReports()
    loadSummary()
  }, [])

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/reports?limit=5`)
      if (!res.ok) throw new Error(String(res.status))
      setReports(await res.json())
    } catch {
      setReports([])
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/reports/summary`)
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setSummary({ categories: data.categories || [], total: data.total || 0 })
    } catch {
      setSummary({ categories: [], total: 0 })
    }
  }, [])

  // ---- core actions --------------------------------------------------------
  const runAnalysis = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? message).trim()
      if (!text || loading) return
      setLoading(true)
      setResult(null)
      setResultError('')
      setFlagNote('')
      setFlagged(false)
      analyzedTextRef.current = text
      try {
        const res = await fetch(`${API_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, language: lang }),
        })
        if (!res.ok) throw new Error(String(res.status))
        setResult(await res.json())
      } catch {
        setResultError(t.resultError)
      } finally {
        setLoading(false)
      }
    },
    [message, loading, lang, t]
  )

  // ---- voice input ----------------------------------------------------------
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setMicNote(t.micUnsupported)
      return
    }
    const rec = new SR()
    rec.lang = lang === 'te' ? 'te-IN' : 'en-IN'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setMessage(transcript)
      runAnalysis(transcript) // fill the box AND analyze immediately
    }
    rec.onerror = () => setMicNote(t.micUnsupported)
    rec.onend = () => {
      setListening(false)
      setMicNote('')
    }
    recognitionRef.current = rec
    setMicNote('')
    setListening(true)
    rec.start()
  }, [lang, t, runAnalysis])

  // ---- screenshot OCR (fully client-side, tesseract.js) ---------------------
  const handleImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setOcrNote(t.ocrBadFile)
      return
    }
    setOcrLoading(true)
    setOcrNote('')
    try {
      // Always load both scripts: scam screenshots are often English text
      // even when the user's UI language is Telugu.
      const worker = await createWorker('eng+tel')
      try {
        const { data } = await worker.recognize(file)
        const text = (data.text || '').trim()
        if (text.length < 5) {
          setOcrNote(t.ocrEmpty)
          return
        }
        setMessage(text)
        runAnalysis(text) // same behavior as clicking an example chip
      } finally {
        await worker.terminate()
      }
    } catch {
      setOcrNote(t.ocrFailed)
    } finally {
      setOcrLoading(false)
    }
  }

  // ---- text-to-speech explanation ------------------------------------------
  const listen = () => {
    if (!result) return
    if (!('speechSynthesis' in window)) {
      setListenNote(t.listenUnsupported)
      return
    }
    const text = `${result.reasoning}. ${result.advice.join('. ')}`
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang === 'te' ? 'te-IN' : 'en-IN'
    utterance.rate = 0.95
    utterance.onend = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  // ---- community flagging ----------------------------------------------------
  const flagIt = async () => {
    if (flagged || !result) return
    setFlagNote('')
    try {
      const res = await fetch(`${API_BASE}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: analyzedTextRef.current.slice(0, 200),
          verdict: result.verdict,
          category: result.matched_patterns?.[0] || 'other',
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setFlagged(true)
      setFlagNote(t.flagged)
      loadReports()
      loadSummary()
    } catch {
      setFlagNote(t.flagError)
    }
  }

  // ---- derived -----------------------------------------------------------------
  const vs = result ? VERDICT_STYLE[result.verdict] : null
  const verdictLabel = result
    ? result.verdict === 'scam'
      ? t.verdictScam
      : result.verdict === 'suspicious'
        ? t.verdictSuspicious
        : t.verdictSafe
    : ''
  const statusColor = status === 'online' ? COLORS.safe : status === 'offline' ? COLORS.scam : COLORS.suspicious

  const cardStyle = {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 20,
    padding: '26px 28px',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `radial-gradient(1100px 560px at 50% -8%, ${COLORS.bgTop} 0%, ${COLORS.bg} 55%)`,
        color: COLORS.text,
        fontFamily: FONT.sans,
        padding: '28px 20px 60px',
      }}
    >
      <style>{pageStyles}</style>

      {/* ============================== header ============================== */}
      <header
        style={{
          maxWidth: 860,
          margin: '0 auto 26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: FONT.serif,
              fontSize: 34,
              fontWeight: 700,
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            {t.title}
          </h1>
          <p style={{ margin: '4px 0 0', color: COLORS.muted, fontSize: 15 }}>{t.subtitle}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              gap: 6,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 999,
              padding: 4,
            }}
          >
            {(['en', 'te']).map((code) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`toggle-btn${lang === code ? ' active' : ''}`}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  background: 'transparent',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={status === 'online' ? t.statusOnline : t.statusOffline}>
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: statusColor,
                display: 'inline-block',
                boxShadow: `0 0 8px ${statusColor}`,
              }}
            />
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: COLORS.muted }}>
              {status === 'online' ? t.statusOnline : status === 'offline' ? t.statusOffline : t.statusChecking}
            </span>
          </div>
        </div>
      </header>

      {/* ============================== input ============================== */}
      <main style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section
          style={cardStyle}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files?.[0]
            if (f) handleImageFile(f)
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files[0] && handleImageFile(e.target.files[0])}
            style={{ display: 'none' }}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.inputPlaceholder}
            rows={5}
            style={{
              width: '100%',
              resize: 'vertical',
              background: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              color: COLORS.text,
              fontFamily: FONT.sans,
              fontSize: 18,
              lineHeight: 1.5,
              padding: 16,
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              onClick={startListening}
              className={`mic-btn${listening ? ' listening' : ''}`}
              disabled={listening}
              title={t.mic}
              style={{
                background: 'transparent',
                border: `1.5px solid ${COLORS.border}`,
                color: COLORS.text,
                borderRadius: 12,
                padding: '16px 20px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {listening ? t.listening : t.mic}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mic-btn"
              disabled={ocrLoading}
              title={t.uploadScreenshot}
              style={{
                background: 'transparent',
                border: `1.5px solid ${COLORS.border}`,
                color: COLORS.text,
                borderRadius: 12,
                padding: '16px 20px',
                fontSize: 15,
                fontWeight: 600,
                cursor: ocrLoading ? 'not-allowed' : 'pointer',
              }}
            >
              📷 {t.uploadScreenshot}
            </button>
            <button
              onClick={() => runAnalysis()}
              disabled={loading || ocrLoading || !message.trim()}
              className="btn-primary"
              style={{
                flex: 1,
                minWidth: 220,
                background: COLORS.accent,
                color: COLORS.bg,
                border: 'none',
                borderRadius: 12,
                padding: '16px 24px',
                fontSize: 18,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {loading ? t.analyzing : t.analyze}
            </button>
          </div>
          {micNote && (
            <p style={{ color: COLORS.suspicious, fontSize: 14, margin: '12px 0 0' }}>{micNote}</p>
          )}
          {ocrLoading && (
            <p style={{ color: COLORS.accent, fontSize: 14, margin: '12px 0 0' }}>
              {t.readingScreenshot}
            </p>
          )}
          {ocrNote && (
            <p style={{ color: COLORS.suspicious, fontSize: 14, margin: '12px 0 0' }}>{ocrNote}</p>
          )}

          <p style={{ margin: '22px 0 10px', color: COLORS.muted, fontSize: 13, fontFamily: FONT.mono }}>
            {t.examplesLabel}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {t.examples.map((ex) => (
              <button
                key={ex.label}
                className="chip"
                onClick={() => {
                  setMessage(ex.text)
                  runAnalysis(ex.text)
                }}
                style={{
                  background: 'transparent',
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                  borderRadius: 999,
                  padding: '10px 16px',
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'all .15s ease',
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </section>

        {/* ============================== result ============================== */}
        {resultError && (
          <section style={{ ...cardStyle, borderColor: COLORS.scam }}>
            <p style={{ margin: 0, color: COLORS.scam, fontSize: 16 }}>{resultError}</p>
          </section>
        )}

        {result && vs && (
          <section style={{ ...cardStyle, borderColor: vs.color }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              {/* lantern badge */}
              <div
                style={{
                  '--glow-color': vs.glow,
                  width: 150,
                  height: 150,
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 35% 30%, ${vs.glow}, transparent 70%)`,
                  border: `3px solid ${vs.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'pulseGlow 2.6s ease-in-out infinite',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: FONT.mono, fontSize: 38, fontWeight: 500, color: vs.color }}>
                  {result.confidence}%
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 10, color: COLORS.muted, letterSpacing: 1 }}>
                  {t.confidence}
                </span>
              </div>

              <div style={{ flex: 1, minWidth: 260 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: FONT.mono,
                    fontSize: 13,
                    letterSpacing: 2,
                    color: vs.color,
                  }}
                >
                  {verdictLabel}
                </p>
                <h2
                  style={{
                    margin: '6px 0 10px',
                    fontFamily: FONT.serif,
                    fontSize: 26,
                    fontWeight: 600,
                    color: vs.color,
                  }}
                >
                  {result.verdict === 'scam'
                    ? t.headlineScam
                    : result.verdict === 'suspicious'
                      ? t.headlineSuspicious
                      : t.headlineSafe}
                </h2>
                <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: COLORS.text }}>
                  {result.reasoning}
                </p>
              </div>
            </div>

            {result.red_flags.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <h3 style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: 1, color: vs.color, margin: '0 0 10px' }}>
                  {t.redFlagsLabel}
                </h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: COLORS.text, fontSize: 16, lineHeight: 1.7 }}>
                  {result.red_flags.map((flag, i) => (
                    <li key={i}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: 1, color: COLORS.muted, margin: '0 0 10px' }}>
                {t.adviceLabel}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 20, color: COLORS.text, fontSize: 16, lineHeight: 1.7 }}>
                {result.advice.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button
                onClick={listen}
                className="btn-secondary"
                style={{
                  background: 'transparent',
                  border: `1.5px solid ${vs.color}`,
                  color: vs.color,
                  borderRadius: 12,
                  padding: '14px 20px',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {speaking ? t.listeningLabel : t.listen}
              </button>

              {result.verdict !== 'safe' && (
                <button
                  onClick={flagIt}
                  disabled={flagged}
                  className="btn-secondary"
                  style={{
                    background: flagged ? 'transparent' : vs.color,
                    border: `1.5px solid ${vs.color}`,
                    color: flagged ? vs.color : COLORS.bg,
                    borderRadius: 12,
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: flagged ? 'not-allowed' : 'pointer',
                  }}
                >
                  {flagged ? t.flagged : t.flag}
                </button>
              )}
            </div>
            {flagNote && !flagged && (
              <p style={{ color: COLORS.suspicious, fontSize: 14, margin: '12px 0 0' }}>{flagNote}</p>
            )}
            {listenNote && (
              <p style={{ color: COLORS.suspicious, fontSize: 14, margin: '12px 0 0' }}>{listenNote}</p>
            )}
          </section>
        )}

        {/* ============================== community ============================== */}
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 20, fontWeight: 600 }}>
            {t.communityTitle}
          </h2>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reports.length === 0 ? (
              <p style={{ margin: 0, color: COLORS.muted, fontSize: 15 }}>{t.communityEmpty}</p>
            ) : (
              reports.map((r, i) => {
                const rc = VERDICT_STYLE[r.verdict] || VERDICT_STYLE.suspicious
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: COLORS.bg,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: '12px 14px',
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: rc.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 1.5 }}>
                      {r.snippet}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT.mono,
                        fontSize: 11,
                        letterSpacing: 1,
                        color: rc.color,
                        flexShrink: 0,
                      }}
                    >
                      {r.verdict.toUpperCase()}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* ============================== trends ============================== */}
        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 20, fontWeight: 600 }}>
            {t.trendsTitle}
          </h2>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {summary.total === 0 ? (
              <p style={{ margin: 0, color: COLORS.muted, fontSize: 15 }}>{t.trendsEmpty}</p>
            ) : (
              summary.categories.map((cat) => {
                const label = t.categoryNames[cat.category] || cat.category
                const widthPct = Math.max(4, (cat.count / summary.total) * 100)
                return (
                  <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 170,
                        flexShrink: 0,
                        fontSize: 14,
                        color: COLORS.text,
                        textAlign: 'right',
                        lineHeight: 1.4,
                      }}
                    >
                      {label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 22,
                        background: COLORS.bg,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 999,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${widthPct}%`,
                          background: COLORS.accent,
                          borderRadius: 999,
                          boxShadow: `0 0 10px rgba(232, 163, 61, 0.45)`,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 40,
                        flexShrink: 0,
                        fontFamily: FONT.mono,
                        fontSize: 13,
                        color: COLORS.accent,
                      }}
                    >
                      {cat.count}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </main>
    </div>
  )
}