// STANDALONE FILE — single responsibility: detect dangerous installer files.
//
// WHY THIS EXISTS AS A SEPARATE FILE:
// This check was accidentally deleted 3 times when it lived as inline code
// inside App.jsx during full-file rewrites. It now lives here specifically
// so future rewrites of App.jsx cannot silently remove it — App.jsx only
// IMPORTS this function; it does not contain this logic directly.
//
// DO NOT move this logic back into App.jsx. If App.jsx is being rewritten,
// keep the import statement at the top. The logic stays here.

const DANGEROUS_EXTENSIONS = [
  ".apk",   // Android app installer — classic malware delivery vector
  ".apks",  // Android app bundle
  ".exe",   // Windows executable
  ".msi",   // Windows installer
  ".bat",   // Windows batch script
  ".sh",    // Unix shell script
  ".jar",   // Java archive executable
];

/**
 * Returns true if the given filename has a dangerous installer extension.
 * This is a deterministic filename check — it is NOT content analysis.
 * @param {string} filename
 * @returns {boolean}
 */
export function checkDangerousFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return DANGEROUS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Returns a verdict object for a dangerous installer file, formatted the same
 * way as the /analyze backend response so the existing result card renders it.
 * @param {string} lang  "en" or "te"
 * @returns {object}
 */
export function buildDangerousFileVerdict(lang) {
  return {
    verdict: "scam",
    confidence: 98,
    reasoning:
      lang === "te"
        ? "చాట్ ద్వారా నేరుగా పంపిన యాప్ ఫైల్ (.apk) దాదాపు ఎల్లప్పుడూ మాల్వేర్ — ఇది బ్యాంకింగ్ వివరాలు దొంగిలించడానికి లేదా మీ ఫోన్పై నియంత్రణ పొందడానికి ఉపయోగించబడుతుంది."
        : "An app file (.apk) sent directly through chat, outside the Play Store, is almost always malware used to steal banking details or take control of your phone.",
    red_flags:
      lang === "te"
        ? ["చాట్‌లో నేరుగా పంపిన యాప్ ఫైల్ (.apk)", "ప్లే స్టోర్ / యాప్ స్టోర్ నుండి కాదు"]
        : ["App file (.apk) shared directly in chat", "Not from Play Store / App Store"],
    advice:
      lang === "te"
        ? ["దీన్ని ఇన్‌స్టాల్ చేయవద్దు", "ఫైల్‌ను తొలగించి పంపినవారిని బ్లాక్ చేయండి"]
        : ["Do not install it", "Delete the file and block the sender"],
  };
}
