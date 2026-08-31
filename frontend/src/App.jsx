import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { COLORS, FONT, PAGE_STYLES } from './tokens.js'
import { checkDangerousFile, buildDangerousFileVerdict } from './dangerousFileCheck.js'

// ---------------------------------------------------------------------------
// Backend base URL. In dev, the Vite proxy forwards /api/* -> http://127.0.0.1:8000
// (stripping the /api prefix). Override with VITE_API_BASE for other setups.
// The frontend NEVER talks to the LLM directly — every analysis goes through
// the backend pipeline.
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// ===========================================================================
// REGRESSION-SENSITIVE FEATURES — verify these still exist after any full-file rewrite:
// 1. Dangerous file extension check (.apk/.exe/etc.) — must run FIRST in handleImageFile
// 2. OCR review-before-submit (extracted text is NOT auto-analyzed, user presses Check)
// 3. Vision-extraction-first with Tesseract OCR fallback
// 4. Listen button reads result.reasoning/redFlags/advice, NEVER the raw input message
// If you are about to output a full rewrite of this file, confirm all 4 are still present
// in your output before finishing your response.
// ===========================================================================

// ---------------------------------------------------------------------------
// Bilingual copy. Every piece of UI text lives here — nothing is hardcoded
// in the components below.
// ---------------------------------------------------------------------------
const COPY = {
  en: {
    title: 'Scam Shield',
    subtitle: 'Verify the message below',
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
    confirmRecording: 'Use this text',
    uploadScreenshot: 'Upload a screenshot',
    readingScreenshot: 'Reading the screenshot…',
    ocrEmpty: "Couldn't find any text in that image — try a clearer screenshot.",
    ocrBadFile: 'Please upload an image file.',
    ocrFailed: 'Something went wrong reading that image. Please try again.',
    ocrGarbage:
      "Couldn't read this image clearly — this often happens with dark-mode screenshots or cluttered layouts. " +
      'Try: switching to light mode before taking the screenshot, cropping tightly to just the message, or typing the message manually.',
    reviewOcrText: 'Extracted from your screenshot — please check it looks right before checking.',
    ocrChars: 'characters extracted',
    cropTip: 'For best results, crop the screenshot to just the message before uploading.',
    verdictScam: 'SCAM',
    verdictSuspicious: 'SUSPICIOUS',
    verdictSafe: 'SAFE',
    verdictFraud: 'FRAUD',
    headlineScam: 'Likely a scam — be very careful.',
    headlineSuspicious: 'Looks suspicious — verify before acting.',
    headlineSafe: 'Looks safe — no red flags found.',
    confidence: 'confidence',
    reasoningLabel: 'Why we think so',
    redFlagsLabel: 'Red flags we found',
    adviceLabel: 'What to do next',
    reasonButton: 'Reason',
    hideReasonButton: 'Hide reason',
    listen: 'Listen',
    pause: 'Pause',
    resume: 'Resume',
    speakError: 'Could not load the audio explanation. Please try again.',
    audioUnavailable: "Audio isn't available right now — here's the written explanation above.",
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
      'fake_credit_withdrawal': 'Fake credit withdrawal',
      'fake-credit-withdrawal': 'Fake credit withdrawal',
      'routine-bill': 'Routine bill',
      'user-triggered-otp': 'User-triggered OTP',
      'known-contact-routine': 'Known contact',
      other: 'Other',
    },
    resultError: 'Could not reach the backend. Is the server running? (backend folder: uvicorn app.main:app --reload)',
  },
  te: {
    title: 'Scam Shield',
    subtitle: 'కింది సందేశాన్ని తనిఖీ చేయండి.',
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
    confirmRecording: 'ఈ టెక్స్ట్ ఉపయోగించండి',
    uploadScreenshot: 'స్క్రీన్‌షాట్ అప్‌లోడ్ చేయండి',
    readingScreenshot: 'స్క్రీన్‌షాట్ చదువుతున్నాం…',
    ocrEmpty: 'ఆ చిత్రంలో ఎటువంటి అక్షరాలు కనిపించలేదు — మరింత స్పష్టమైన స్క్రీన్‌షాట్ ప్రయత్నించండి.',
    ocrBadFile: 'దయచేసి చిత్రం (ఇమేజ్) ఫైల్ అప్‌లోడ్ చేయండి.',
    ocrFailed: 'ఆ చిత్రాన్ని చదవడంలో ఏదో సమస్య జరిగింది. మళ్ళీ ప్రయత్నించండి.',
    ocrGarbage:
      'ఈ చిత్రాన్ని స్పష్టంగా చదవలేకపోయాం — ఇది డార్క్ మోడ్ స్క్రీన్‌షాట్లు లేదా రద్దీగా ఉన్న చిత్రాలలో తరచూ జరుగుతుంది. ' +
      'ప్రయత్నించండి: స్క్రీన్‌షాట్ తీసే ముందు లైట్ మోడ్‌కి మారండి, సందేశం వరకే కత్తిరించండి, లేదా సందేశాన్ని నేరుగా టైప్ చేయండి.',
    reviewOcrText: 'మీ స్క్రీన్‌షాట్ నుండి సంగ్రహించబడింది — తనిఖీ చేసే ముందు అది సరిగ్గా ఉందని నిర్ధారించుకోండి.',
    ocrChars: 'అక్షరాలు సంగ్రహించబడ్డాయి',
    cropTip: 'ఉత్తమ ఫలితాల కోసం, దయచేసి స్క్రీన్‌షాట్‌ను సందేశం వరకే కత్తిరించి అప్‌లోడ్ చేయండి.',
verdictScam: 'మోసం',
    verdictSuspicious: 'అనుమానం',
    verdictSafe: 'సురక్షితం',
    verdictFraud: 'మోసం',
    headlineScam: 'ఇది మోసం అయ్యే అవకాశం ఉంది — చాలా జాగ్రత్తగా ఉండండి.',
    headlineSuspicious: 'అనుమానాస్పదంగా ఉంది — చర్య తీసుకునే ముందు ధృవీకరించండి.',
    headlineSafe: 'సురక్షితంగా కనిపిస్తోంది — ఎటువంటి ప్రమాదం లేదు.',
    confidence: 'విశ్వాసం',
    reasoningLabel: 'మేము ఎందుకు అలా అనుకుంటున్నాము',
    redFlagsLabel: 'మేము గుర్తించిన హెచ్చరికలు',
    adviceLabel: 'తర్వాత ఏమి చేయాలి',
    reasonButton: 'కారణం',
    hideReasonButton: 'కారణం దాల్చండి',
    listen: 'వినండి',
    pause: 'విరామం',
    resume: 'కొనసాగించండి',
    speakError: 'ఆడియో వివరణ లోడ్ చేయలేకపోయాం. మళ్ళీ ప్రయత్నించండి.',
    audioUnavailable: 'ఆడియో ప్రస్తుతం అందుబాటులో లేదు — పైన ఉన్న వ్రాతపూర్వక వివరణ చదవండి.',
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
      'fake_credit_withdrawal': 'నకిలీ క్రెడిట్ విత్‌డ్రాయల్',
      'fake-credit-withdrawal': 'నకిలీ క్రెడిట్ విత్‌డ్రాయల్',
      'routine-bill': 'సాధారణ బిల్లు',
      'user-triggered-otp': 'యూజర్ OTP',
      'known-contact-routine': 'తెలిసిన వ్యక్తి',
      other: 'ఇతర',
    },
    resultError: 'సర్వర్ కి చేరలేకపోయాం. సర్వర్ నడుస్తోందా? (backend ఫోల్డర్ లో: uvicorn app.main:app --reload)',
  },
}

// Verdict visual config, keyed by the backend's verdict string.
// `soft` is the light-theme tint used for the badge fill + breathing ring.
const VERDICT_STYLE = {
  scam: { color: COLORS.danger, soft: COLORS.dangerSoft },
  suspicious: { color: COLORS.caution, soft: COLORS.cautionSoft },
  safe: { color: COLORS.safe, soft: COLORS.safeSoft },
}

// Light surface for the message textarea — sits on the raised gray so it
// stays visually distinct from the pure-white panels around it.
const INPUT_SURFACE = {
  bg: COLORS.bgPanelRaised,
  text: COLORS.text,
  border: COLORS.hairline,
  placeholder: 'rgba(27, 36, 54, 0.45)',
}

const pageStyles = `${PAGE_STYLES}\n  .msg-input::placeholder { color: ${INPUT_SURFACE.placeholder}; }`

export default function App() {
  const [lang, setLang] = useState('en')
  const t = COPY[lang]

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [resultError, setResultError] = useState('')

  const [status, setStatus] = useState('checking')
  const [recorderState, setRecorderState] = useState('idle') // "idle" | "recording" | "paused"
  const [micNote, setMicNote] = useState('')
  const [listenNote, setListenNote] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrNote, setOcrNote] = useState('')
  const [justOcred, setJustOcred] = useState(false)

  // Audio playback: caches the Audio object + object URL so pause can resume
  // from the same position without re-fetching from the backend.
  const [audioState, setAudioState] = useState('idle') // "idle" | "playing" | "paused"
  const audioRef = useRef(null) // { audio, url }

  const [flagged, setFlagged] = useState(false)
  const [flagNote, setFlagNote] = useState('')
  const [reports, setReports] = useState([])
  const [summary, setSummary] = useState({ categories: [], total: 0 })
  const [showReason, setShowReason] = useState(false)

  const recognitionRef = useRef(null)
  const stagedRef = useRef('') // accumulated transcript across pause/resume
  const pauseRequestedRef = useRef(false) // .stop() was a user pause, not a session end
  const fileInputRef = useRef(null)
  const analyzedTextRef = useRef('')

  // ---- single source of truth for language ---------------------------------
  // `lang` state drives BOTH the /analyze request language (via langRef)
  // and every COPY[lang] label (via t) — there is exactly one language value
  // in this component. langRef is a live mirror, re-synced after EVERY
  // render, so no closure can ever read a stale language.
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  })

  // If a result is showing and the user flips the toggle, the shown content
  // (generated/translated for the old language) would no longer match the
  // labels (rendered from the new one). Re-run the analysis in the new
  // language so the toggle stays the single source of truth end-to-end.
  const prevLangRef = useRef(lang)
  useEffect(() => {
    const changed = prevLangRef.current !== lang
    prevLangRef.current = lang
    if (changed && result && analyzedTextRef.current.trim()) {
      runAnalysis(analyzedTextRef.current)
    }
    // runAnalysis is intentionally NOT in deps: it reads langRef at call
    // time, and it is recreated every render, which would make this effect
    // fire (and re-analyze) on every render instead of only on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, result])

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

// ---- audio playback ------------------------------------------------------
  const clearAudio = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    const cached = audioRef.current
    if (cached) {
      cached.audio.pause()
      URL.revokeObjectURL(cached.url)
      audioRef.current = null
    }
    setAudioState('idle')
  }, [])

  // Warm the browser's voice list at mount so getVoices() is populated when
  // the /speak fallback needs to check for a matching-language voice.
  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices()
  }, [])

  // Fallback #1 for /speak: speak with the browser's built-in speech
  // synthesis. Returns false when unavailable or when no voice exists for
  // the current language, so the caller can show the inline note instead.
  const speakWithBrowserFallback = useCallback((text) => {
    if (!('speechSynthesis' in window)) return false
    const synth = window.speechSynthesis
    const langPrefix = langRef.current === 'te' ? 'te' : 'en'
    const voices = synth.getVoices()
    const matching = voices.find((v) =>
      (v.lang || '').toLowerCase().startsWith(langPrefix)
    )
    if (!matching) return false
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = langRef.current === 'te' ? 'te-IN' : 'en-IN'
    if (matching) utterance.voice = matching
    synth.speak(utterance)
    return true
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
      setJustOcred(false)
      setShowReason(false)
      analyzedTextRef.current = text
      try {
        const res = await fetch(`${API_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, language: langRef.current }),
        })
        if (!res.ok) throw new Error(String(res.status))
        clearAudio() // new verdict → old audio must not carry over
        setResult(await res.json())
      } catch {
        setResultError(t.resultError)
      } finally {
        setLoading(false)
      }
    },
    [message, loading, t, clearAudio]
  )

  // ---- voice input (3-state recorder: idle -> recording -> paused) ----------
  // One recognition instance per segment. Pause calls .stop() and keeps the
  // staged transcript; resume starts a NEW instance that APPENDS to the staged
  // transcript; Upload finalizes the session WITHOUT triggering /analyze — the
  // user still presses the main Check button, matching the OCR review flow.
  const beginRecognition = useCallback(
    (fresh) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SR) {
        setMicNote(t.micUnsupported)
        return
      }
      if (fresh) stagedRef.current = ''
      pauseRequestedRef.current = false // a new session owns the controls from here on
      const rec = new SR()
      rec.lang = lang === 'te' ? 'te-IN' : 'en-IN'
      rec.continuous = false
      rec.interimResults = false
      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript
        const next = [stagedRef.current, transcript].filter(Boolean).join(' ')
        stagedRef.current = next
        setMessage(next) // live into the textarea; user reviews before checking
      }
      rec.onerror = (event) => {
        if (event?.error === 'aborted') return // caused by our own stop() — not a failure
        setMicNote(t.micUnsupported)
      }
      rec.onend = () => {
        // Ignore endings from superseded instances: if the user already
        // paused->resumed (or uploaded) a NEW session, the old instance's
        // onend must not clobber the current recorder state.
        if (recognitionRef.current !== rec) return
        if (pauseRequestedRef.current) {
          pauseRequestedRef.current = false
          setRecorderState('paused')
        } else {
          setRecorderState('idle')
        }
        setMicNote('')
      }
      recognitionRef.current = rec
      setMicNote('')
      setRecorderState('recording')
      try {
        rec.start()
      } catch {
        // e.g. permission denied — don't leave the UI stuck in "recording"
        recognitionRef.current = null
        setRecorderState('idle')
        setMicNote(t.micUnsupported)
      }
    },
    [lang, t]
  )

  const startListening = useCallback(() => beginRecognition(true), [beginRecognition])

  const resumeRecorder = useCallback(() => beginRecognition(false), [beginRecognition])

  const pauseRecorder = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) return
    pauseRequestedRef.current = true
    let stopped = true
    try {
      rec.stop() // keeps stagedRef.current — resumed later by a new instance
    } catch {
      stopped = false // recognition had already ended — onend already reset state
    }
    // Transition immediately so the UI never shows "recording" while nothing
    // is listening, even if onend is delayed or unreliable in some browsers.
    if (stopped && recognitionRef.current === rec) {
      setRecorderState('paused')
    }
  }, [])

  const uploadRecorder = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch {
        // already stopped (session was paused) — nothing to do
      }
    }
    recognitionRef.current = null
    pauseRequestedRef.current = false
    setMessage(stagedRef.current) // staged is already live in the box; end cleanly
    setRecorderState('idle')
    setMicNote('')
  }, [])

  // ---- Garbage OCR detection — applied ONLY to Tesseract fallback output ----
  // Vision output (from Gemini) is already coherent prose; we never second-guess it.
  // Tesseract can produce random glyphs/symbols on dark-mode or cluttered images;
  // this heuristic catches that before it silently populates the textarea.
  const looksLikeGarbageOcr = (text) => {
    if (!text || text.trim().length < 5) return true
    const cleaned = text.replace(/\s/g, '')
    if (cleaned.length === 0) return true
    // Count characters that are normal readable text
    const readableChars = (cleaned.match(/[\p{L}\p{N}.,!?@:/\-]/gu) || []).length
    const readableRatio = readableChars / cleaned.length
    // Count how many space-separated tokens are at least 2 chars (proxy for real words)
    const words = text.trim().split(/\s+/).filter((w) => w.length >= 2)
    const totalTokens = text.trim().split(/\s+/).length
    const wordRatio = totalTokens > 0 ? words.length / totalTokens : 0
    return readableRatio < 0.7 || wordRatio < 0.4
  }

  // ---- UI noise stripping (Continuation 16) — general-purpose, not app-specific
  // Strips common non-message boilerplate (Truecaller banners, WhatsApp encrypted
  // notices, timestamps, status bar) after OCR; conservative to avoid stripping
  // real scam content (amounts, links, "before 9PM").
  const UI_NOISE_PATTERNS = [
    // Truecaller / caller-ID app chrome
    /you reported this sender as fraud[.\s\S]*?outside the app\.?/gi,
    /is 100% secure\.?\s*truecaller never uses this information\.?/gi,
    /everything is processed and stored on your phone\.?/gi,
    /this contact is blocked[.\s\S]*?communicate with them again\.?/gi,
    /unblock/gi,
    // WhatsApp chrome
    /messages and calls are end-to-end encrypted[.\s\S]*?(read them|share them)\.?/gi,
    /tap to (learn more|call|video call)/gi,
    /\b(delivered|read|online|typing\.\.\.)\b/gi,
    /last seen [^\n]*/gi,
    // Generic messaging UI chrome
    /\btoday\b/gi,
    /\byesterday\b/gi,
    /\bsms\s*[•·]\s*\d{1,2}:\d{2}\s*(am|pm)?/gi,
    /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, // bare timestamps, only after more specific patterns above
    // Status bar noise
    /\b(volte|lte|4g|5g|wifi)\b/gi,
    // Transaction card label only (amounts are real content)
    /^\s*transaction\s*$/gim,
  ]

  const stripUiNoise = (text) => {
    let cleaned = text
    for (const pattern of UI_NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ')
    }
    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
    return cleaned
  }

  // Continuation 15: contrast-boost preprocessing for low-contrast light-gray bubbles
  const preprocessImageToBlob = async (file) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = url
      })
      const SCALE = 1.75
      const w = Math.round(img.width * SCALE)
      const h = Math.round(img.height * SCALE)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d unavailable')
      ctx.drawImage(img, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)
      const data = imgData.data
      // histogram for contrast stretch
      const hist = new Array(256).fill(0)
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
        hist[gray]++
      }
      const total = w * h
      let lo = 0
      let cum = 0
      for (let i = 0; i < 256; i++) {
        cum += hist[i]
        if (cum / total >= 0.1) { lo = i; break }
      }
      let hi = 255
      cum = 0
      for (let i = 255; i >= 0; i--) {
        cum += hist[i]
        if (cum / total >= 0.1) { hi = i; break }
      }
      if (hi - lo >= 30) {
        const range = hi - lo
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
          const stretched = Math.max(0, Math.min(255, Math.round(((gray - lo) / range) * 255)))
          data[i] = stretched
          data[i + 1] = stretched
          data[i + 2] = stretched
        }
        ctx.putImageData(imgData, 0, 0)
      } else {
        // not enough contrast range — still convert to grayscale for Tesseract
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
          data[i] = gray
          data[i + 1] = gray
          data[i + 2] = gray
        }
        ctx.putImageData(imgData, 0, 0)
      }
      const blob = await new Promise((res, rej) => {
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), file.type || 'image/png', 0.92)
      })
      return blob
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // ---- vision-based extraction (PRIMARY) ------------------------------------
  // A vision-capable LLM understands screenshot layout and context, so it can
  // pull out ONLY the real message and drop fraud banners / status bar / app
  // chrome — something OCR (pixel patterns only) can never do reliably. This
  // is tried first; on any failure the caller falls back to Tesseract OCR.
  const extractViaVision = useCallback(async (file) => {
    const form = new FormData()
    form.append('file', file)
    console.log('[LAYER3-DIAG] Calling /extract-message-from-image for file:', file.name, 'size:', file.size)
    const res = await fetch(`${API_BASE}/extract-message-from-image`, {
      method: 'POST',
      body: form,
    })
    console.log('[LAYER3-DIAG] /extract-message-from-image HTTP status:', res.status)
    if (!res.ok) {
      const errText = await res.text()
      console.error('[LAYER3-DIAG] VISION FAILED — server returned non-OK:', res.status, errText)
      throw new Error(String(res.status))
    }
    const json = await res.json()
    // *** IMPOSSIBLE-TO-MISS DIAGNOSTIC LOG — LAYER 3 ***
    console.log('VISION RESPONSE:', json)
    console.log('[LAYER3-DIAG] Extracted text length:', (json.text || '').trim().length, 'chars')
    console.log('[LAYER3-DIAG] Extracted text preview:', (json.text || '').trim().slice(0, 200))
    return (json.text || '').trim()
  }, [])

  // ---- screenshot OCR (fully client-side, tesseract.js) ---------------------
  // Fix A: Tesseract's default data.text ordering can jumble disconnected blocks
  // (chat bubble, Truecaller banner, Smart SMS notice). We reconstruct text
  // ourselves from word bounding boxes, sorted top->bottom then left->right,
  // and use PSM 11 (sparse text) which is best for multiple disconnected blocks.
  const handleImageFile = async (file) => {
    // -------------------------------------------------------------------------
    // CRITICAL SAFETY CHECK — runs FIRST, before OCR/vision/LLM.
    // Logic lives in ./dangerousFileCheck.js — DO NOT inline it here again.
    // If you are rewriting App.jsx, keep this import call; the logic stays in
    // dangerousFileCheck.js so it cannot be silently lost during full rewrites.
    // -------------------------------------------------------------------------
    if (file && checkDangerousFile(file.name)) {
      setResult(buildDangerousFileVerdict(lang))
      setOcrLoading(false)
      setOcrNote('')
      setJustOcred(false)
      setShowReason(false)
      return // STOP — do not proceed to OCR, vision API, or /analyze
    }

    if (!file || !file.type.startsWith('image/')) {
      setOcrNote(t.ocrBadFile)
      return
    }
    setOcrLoading(true)
    setOcrNote('')
    setJustOcred(false)
    try {
      // PRIMARY path: vision extraction on the backend. If it returns usable
      // text, use it directly (user still reviews via the "check it looks
      // right" hint before checking). Any failure (no API key, network,
      // non-OK response) silently falls through to the offline OCR pipeline.
      try {
        const visionText = await extractViaVision(file)
        if (visionText && visionText.length >= 3) {
          setMessage(visionText)
          setJustOcred(true)
          return
        }
      } catch {
        // fall back to Tesseract — no user-facing error here.
      }

      // Always load both scripts: scam screenshots are often English text
      // even when the user's UI language is Telugu.
      const worker = await createWorker('eng+tel')
      try {
        // PSM 11 = sparse text (multiple disconnected blocks). Default is 3.
        // Guard the call — older tesseract.js builds may not expose setParameters.
        try {
          await worker.setParameters({ tessedit_pageseg_mode: '11' })
        } catch {
          // ignore — fall back to default PSM
        }

        const reconstruct = (data) => {
          let t = ''
          const rawWords = data.words || null
          const rawLines = data.lines || null
          const sourceWords = rawWords && rawWords.length ? rawWords : null
          if (sourceWords) {
            const normalized = sourceWords
              .map((w) => {
                const b = w.bbox || w
                return { text: (w.text || '').trim(), x0: b.x0 ?? b.x ?? 0, y0: b.y0 ?? b.y ?? 0 }
              })
              .filter((w) => w.text)
            if (normalized.length) {
              normalized.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
              const Y_TOL = 14
              const lines = []
              for (const w of normalized) {
                let placed = false
                for (const line of lines) {
                  const avgY = line.reduce((s, o) => s + o.y0, 0) / line.length
                  if (Math.abs(w.y0 - avgY) < Y_TOL) { line.push(w); placed = true; break }
                }
                if (!placed) lines.push([w])
              }
              for (const line of lines) line.sort((a, b) => a.x0 - b.x0)
              lines.sort((a, b) => {
                const ay = a.reduce((s, o) => s + o.y0, 0) / a.length
                const by = b.reduce((s, o) => s + o.y0, 0) / b.length
                return ay - by
              })
              t = lines.map((line) => line.map((w) => w.text).join(' ')).join('\n').trim()
            }
          } else if (rawLines && rawLines.length) {
            const normalized = rawLines
              .map((l) => {
                const b = l.bbox || l
                return { text: (l.text || '').trim(), y0: b.y0 ?? b.y ?? 0, x0: b.x0 ?? b.x ?? 0 }
              })
              .filter((l) => l.text)
            if (normalized.length) {
              normalized.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
              t = normalized.map((l) => l.text).join('\n').trim()
            }
          }
          if (!t) t = (data.text || '').trim()
          return t
        }

        const logDiagnostic = (data, label) => {
          try {
            if (data.words && data.words.length) {
              const words = data.words.map((w) => ({
                text: w.text,
                confidence: Math.round(w.confidence ?? 0),
              }))
              console.log(`[OCR ${label}] words:`, words)
              const hasSms = words.some((w) => /credited|withdraw|9pm|bit\.ly|greatdeal/i.test(w.text))
              console.log(`[OCR ${label}] contains SMS tokens?`, hasSms)
            } else {
              console.log(`[OCR ${label}] no words, text length`, (data.text || '').length)
            }
          } catch {
            // diagnostic must never break OCR
          }
        }

        let sourceBlob = file
        let preprocessedBlob = null
        try {
          preprocessedBlob = await preprocessImageToBlob(file)
          sourceBlob = preprocessedBlob
        } catch (e) {
          console.warn('[OCR] preprocess failed, falling back to original', e)
          sourceBlob = file
        }

        let { data } = await worker.recognize(sourceBlob)
        logDiagnostic(data, 'preprocessed')
        let text = reconstruct(data)

        // Fallback: preprocessed can hurt already good contrast images — retry original if too short
        if (!text || text.trim().length < 15) {
          console.log('[OCR] preprocessed text too short, retrying original', text?.length)
          try {
            const fallback = await worker.recognize(file)
            logDiagnostic(fallback.data, 'original-fallback')
            const fallbackText = reconstruct(fallback.data)
            if (fallbackText && fallbackText.trim().length > (text?.trim().length || 0)) {
              text = fallbackText
              data = fallback.data
            }
          } catch {
            // keep original text
          }
        }

        if (!text || text.trim().length < 5) {
          setOcrNote(t.ocrEmpty)
          return
        }

        // Continuation 16: strip UI boilerplate before showing/analyzing
        const cleanedText = stripUiNoise(text)
        if (!cleanedText || cleanedText.trim().length < 10) {
          // entire extraction was UI noise — do not analyze empty string
          setOcrNote(t.ocrEmpty)
          return
        }

        // Garbage-output safety net: Tesseract on dark-mode / cluttered images
        // sometimes produces random symbols instead of real text. Catch that
        // BEFORE populating the textarea so users never see (or act on) nonsense.
        // This check applies ONLY to this Tesseract path — vision output is
        // already coherent prose and must not be filtered by this heuristic.
        if (looksLikeGarbageOcr(cleanedText)) {
          setOcrNote(t.ocrGarbage)
          return
        }

        // Fill the textarea with the CLEANED text but do NOT auto-analyze:
        // OCR often mangles the text, so the user reviews/edits it first and
        // presses the explicit Check button themselves. The cleaned length is
        // what the character-count indicator reflects.
        setMessage(cleanedText)
        setJustOcred(true)
      } finally {
        await worker.terminate()
      }
    } catch {
      setOcrNote(t.ocrFailed)
    } finally {
      setOcrLoading(false)
    }
  }

  // ---- audio explanation (POST /speak + cached Audio for pause/resume) ----
  // Fallback chain: backend TTS -> browser speech synthesis -> inline note.
  // A /speak failure (e.g. no internet on the backend) must never dead-end;
  // the click handler keeps working and the rest of the UI is unaffected.

  // The spoken text is built EXCLUSIVELY from the verdict result — reasoning,
  // then every red flag, then every advice item — so the result-card
  // "Listen" button reads back the explanation, never the raw input message.
  // This function must never reference the `message` state (that stays the
  // job of the separate input-area voice buttons).
  const buildSpokenExplanation = useCallback((verdictResult) => {
    if (!verdictResult) return ''
    return [
      verdictResult.reasoning,
      ...(verdictResult.red_flags || []),
      ...(verdictResult.advice || []),
    ]
      .filter(Boolean)
      .join('. ')
  }, [])

  const playAudio = useCallback(async () => {
    setListenNote('')
    if (audioRef.current) {
      await audioRef.current.audio.play()
      setAudioState('playing')
      return
    }
    const spokenText = buildSpokenExplanation(result)
    if (!spokenText) return // no result to read (button only renders with one)
    try {
      const res = await fetch(`${API_BASE}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: spokenText, language: langRef.current }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => clearAudio()
      audioRef.current = { audio, url }
      await audio.play()
      setAudioState('playing')
    } catch {
      clearAudio()
      if (!speakWithBrowserFallback(spokenText)) {
        setListenNote(t.audioUnavailable)
      }
    }
  }, [buildSpokenExplanation, clearAudio, result, speakWithBrowserFallback, t])

  const toggleAudio = () => {
    if (audioState === 'playing') {
      audioRef.current?.audio.pause()
      setAudioState('paused')
    } else if (audioState === 'paused') {
      audioRef.current?.audio.play()
      setAudioState('playing')
    } else {
      playAudio()
    }
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
  // Two-outcome display mapping (display-only): safe -> SAFE (green),
  // suspicious AND scam -> FRAUD (red). The backend verdict, the confidence
  // badge, and the reasoning/red-flags/advice below keep the full 3-value
  // nuance — only this big final-outcome label is binarized.
  const displayVerdict = result
    ? result.verdict === 'safe'
      ? t.verdictSafe
      : t.verdictFraud
    : ''
  const displayVerdictColor = result && result.verdict !== 'safe' ? COLORS.danger : COLORS.safe
  // The circular badge is binarized too — no number, just the color-coded
  // status: safe -> green, suspicious AND scam -> red. Reuses the existing
  // VERDICT_STYLE entries so colors/rings stay consistent with the tokens.
  const badgeDisplay = result
    ? result.verdict === 'safe'
      ? VERDICT_STYLE.safe
      : VERDICT_STYLE.scam
    : null
  const statusColor = status === 'online' ? COLORS.safe : status === 'offline' ? COLORS.danger : COLORS.caution

  const cardStyle = {
    background: COLORS.bgPanel,
    border: `1px solid ${COLORS.hairline}`,
    borderRadius: 20,
    padding: '26px 28px',
    boxShadow: COLORS.cardShadow,
  }

  const toolBtnStyle = {
    background: COLORS.bgPanelRaised,
    border: `1.5px solid ${COLORS.hairline}`,
    color: COLORS.text,
    borderRadius: 12,
    padding: '16px 20px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
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
          <p style={{ margin: '4px 0 0', color: COLORS.textMuted, fontFamily: FONT.serif, fontSize: 30 }}>{t.subtitle}</p>
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
            {(['en', 'te']).map((code) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`toggle-btn${lang === code ? ' active' : ''}`}
                style={{
                  border: `1px solid ${COLORS.hairline}`,
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
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: COLORS.textMuted }}>
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
            accept="image/*,.apk,.exe,.msi,.bat,.sh,.jar,.apks"
            onChange={(e) => e.target.files[0] && handleImageFile(e.target.files[0])}
            style={{ display: 'none' }}
          />
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              setJustOcred(false)
            }}
            placeholder={t.inputPlaceholder}
            rows={5}
            className="msg-input"
            style={{
              width: '100%',
              resize: 'vertical',
              background: INPUT_SURFACE.bg,
              border: `1px solid ${INPUT_SURFACE.border}`,
              borderRadius: 14,
              color: INPUT_SURFACE.text,
              fontFamily: FONT.sans,
              fontSize: 18,
              lineHeight: 1.5,
              padding: 16,
              outline: 'none',
            }}
          />

          {justOcred && (
            <p style={{ color: COLORS.lanternDark, fontSize: 14, margin: '12px 0 0' }}>
              {t.reviewOcrText} <span style={{ opacity: 0.85 }}>({message.length} {t.ocrChars})</span>
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {recorderState === 'idle' ? (
              <button onClick={startListening} className="mic-btn" title={t.mic} style={toolBtnStyle}>
                🎤 {t.mic}
              </button>
            ) : (
              <>
                {recorderState === 'recording' ? (
                  <button onClick={pauseRecorder} className="mic-btn listening" title={t.pause} style={toolBtnStyle}>
                    ⏸ {t.pause}
                  </button>
                ) : (
                  <button onClick={resumeRecorder} className="mic-btn" title={t.resume} style={toolBtnStyle}>
                    ▶ {t.resume}
                  </button>
                )}
                <button onClick={uploadRecorder} className="mic-btn" title={t.confirmRecording} style={toolBtnStyle}>
                  ✓ {t.confirmRecording}
                </button>
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mic-btn"
              disabled={ocrLoading}
              title={t.uploadScreenshot}
              style={{ ...toolBtnStyle, cursor: ocrLoading ? 'not-allowed' : 'pointer' }}
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
                background: COLORS.lantern,
                color: COLORS.text,
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
          <p style={{ color: COLORS.textMuted, fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.4 }}>
            {t.cropTip}
          </p>
          {recorderState === 'recording' && (
            <p style={{ color: COLORS.lanternDark, fontSize: 14, margin: '12px 0 0' }}>{t.listening}</p>
          )}
          {micNote && (
            <p style={{ color: COLORS.danger, fontSize: 14, margin: '12px 0 0' }}>{micNote}</p>
          )}
          {ocrLoading && (
            <p style={{ color: COLORS.lanternDark, fontSize: 14, margin: '12px 0 0' }}>
              {t.readingScreenshot}
            </p>
          )}
          {ocrNote && (
            <p style={{ color: COLORS.danger, fontSize: 14, margin: '12px 0 0' }}>{ocrNote}</p>
          )}
        </section>

        {/* ============================== result ============================== */}
        {resultError && (
          <section style={{ ...cardStyle, borderColor: COLORS.danger }}>
            <p style={{ margin: 0, color: COLORS.danger, fontSize: 16 }}>{resultError}</p>
          </section>
        )}

        {result && vs && (
          <section style={{ ...cardStyle, borderColor: vs.color }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              {/* lantern badge — color-coded status only, no numeric confidence.
                  (Confidence still comes back in the API payload; we just don't
                  display it. Below the badge the full explanation still shows.)
                  Light-theme treatment: soft tinted fill, solid colored border,
                  and a breathing soft ring (pulseGlow) instead of the old
                  glow-on-dark radial halo. */}
              <div
                style={{
                  '--glow-color': badgeDisplay.soft,
                  width: 150,
                  height: 150,
                  borderRadius: '50%',
                  background: badgeDisplay.soft,
                  border: `3px solid ${badgeDisplay.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'pulseGlow 2.6s ease-in-out infinite',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: FONT.serif, fontSize: 56, fontWeight: 700, lineHeight: 1, color: badgeDisplay.color }}>
                  {result.verdict === 'safe' ? '✓' : '!'}
                </span>
              </div>

              <div style={{ flex: 1, minWidth: 260 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: FONT.mono,
                    fontSize: 13,
                    letterSpacing: 2,
                    color: displayVerdictColor,
                  }}
                >
                  {displayVerdict}
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
                {!showReason ? (
                  <button
                    onClick={() => setShowReason(true)}
                    style={{
                      background: 'transparent',
                      border: `1.5px solid ${vs.color}`,
                      color: vs.color,
                      borderRadius: 12,
                      padding: '10px 18px',
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: FONT.sans,
                    }}
                  >
                    {t.reasonButton}
                  </button>
                ) : (
                  <>
                    <p style={{ margin: '12px 0 0', fontSize: 17, lineHeight: 1.6, color: COLORS.text }}>
                      {result.reasoning}
                    </p>
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
                      <h3 style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: 1, color: COLORS.textMuted, margin: '0 0 10px' }}>
                        {t.adviceLabel}
                      </h3>
                      <ul style={{ margin: 0, paddingLeft: 20, color: COLORS.text, fontSize: 16, lineHeight: 1.7 }}>
                        {result.advice.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      onClick={() => setShowReason(false)}
                      style={{
                        background: 'transparent',
                        border: `1.5px solid ${vs.color}`,
                        color: vs.color,
                        borderRadius: 12,
                        padding: '10px 18px',
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: FONT.sans,
                        marginTop: 16,
                      }}
                    >
                      {t.hideReasonButton}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button
                onClick={toggleAudio}
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
                {audioState === 'playing'
                  ? `⏸ ${t.pause}`
                  : audioState === 'paused'
                    ? `▶ ${t.resume}`
                    : `🔊 ${t.listen}`}
              </button>

              {result.verdict !== 'safe' && (
                <button
                  onClick={flagIt}
                  disabled={flagged}
                  className="btn-secondary"
                  style={{
                    background: flagged ? 'transparent' : vs.color,
                    border: `1.5px solid ${vs.color}`,
                    color: flagged ? vs.color : COLORS.text,
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
              <p style={{ color: COLORS.danger, fontSize: 14, margin: '12px 0 0' }}>{flagNote}</p>
            )}
            {listenNote && (
              <p style={{ color: COLORS.danger, fontSize: 14, margin: '12px 0 0' }}>{listenNote}</p>
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
              <p style={{ margin: 0, color: COLORS.textMuted, fontSize: 15 }}>{t.communityEmpty}</p>
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
                      background: COLORS.bgPanelRaised,
                      border: `1px solid ${COLORS.hairline}`,
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
              <p style={{ margin: 0, color: COLORS.textMuted, fontSize: 15 }}>{t.trendsEmpty}</p>
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
                        background: COLORS.bgPanelRaised,
                        border: `1px solid ${COLORS.hairline}`,
                        borderRadius: 999,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${widthPct}%`,
                          background: COLORS.lantern,
                          borderRadius: 999,
                          boxShadow: `0 0 10px rgba(217, 144, 31, 0.35)`,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 40,
                        flexShrink: 0,
                        fontFamily: FONT.mono,
                        fontSize: 13,
                        color: COLORS.lanternDark,
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