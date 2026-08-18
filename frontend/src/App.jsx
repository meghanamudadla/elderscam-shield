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
    reviewOcrText: 'Extracted from your screenshot — please check it looks right before checking.',
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
    verdictFraud: 'FRAUD',
    headlineScam: 'Likely a scam — be very careful.',
    headlineSuspicious: 'Looks suspicious — verify before acting.',
    headlineSafe: 'Looks safe — no red flags found.',
    confidence: 'confidence',
    reasoningLabel: 'Why we think so',
    redFlagsLabel: 'Red flags we found',
    adviceLabel: 'What to do next',
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
    reviewOcrText: 'మీ స్క్రీన్‌షాట్ నుండి సంగ్రహించబడింది — తనిఖీ చేసే ముందు అది సరిగ్గా ఉందని నిర్ధారించుకోండి.',
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
    verdictFraud: 'మోసం',
    headlineScam: 'ఇది మోసం అయ్యే అవకాశం ఉంది — చాలా జాగ్రత్తగా ఉండండి.',
    headlineSuspicious: 'అనుమానాస్పదంగా ఉంది — చర్య తీసుకునే ముందు ధృవీకరించండి.',
    headlineSafe: 'సురక్షితంగా కనిపిస్తోంది — ఎటువంటి ప్రమాదం లేదు.',
    confidence: 'విశ్వాసం',
    reasoningLabel: 'మేము ఎందుకు అలా అనుకుంటున్నాము',
    redFlagsLabel: 'మేము గుర్తించిన హెచ్చరికలు',
    adviceLabel: 'తర్వాత ఏమి చేయాలి',
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

  // ---- screenshot OCR (fully client-side, tesseract.js) ---------------------
  const handleImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setOcrNote(t.ocrBadFile)
      return
    }
    setOcrLoading(true)
    setOcrNote('')
    setJustOcred(false)
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
        // Fill the textarea with the extracted text but do NOT auto-analyze:
        // OCR often mangles the text, so the user reviews/edits it first and
        // presses the explicit Check button themselves.
        setMessage(text)
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
            accept="image/*"
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
              {t.reviewOcrText}
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

          <p style={{ margin: '22px 0 10px', color: COLORS.textMuted, fontSize: 13, fontFamily: FONT.mono }}>
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
                  border: `1px solid ${COLORS.hairline}`,
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
              <h3 style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: 1, color: COLORS.textMuted, margin: '0 0 10px' }}>
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