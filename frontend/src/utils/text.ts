export function normalizeModelText(content: string): string {
  if (!content) return ''

  const unwrapped = unwrapLikelySerializedString(content)

  return unwrapped
    // Handle doubly-escaped control characters first (e.g., "\\n")
    .replace(/\\\\r\\\\n/g, '\\r\\n')
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\r/g, '\\r')
    .replace(/\\\\t/g, '\\t')
    // Handle escaped control characters (e.g., "\n")
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    // Normalize native line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Unescape serialized quotes
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")

    .trim()
    // Drop non-printing control characters (except tab/newline)
    .split('')
    .filter(keepPrintableChar)
    .join('')
}

function unwrapLikelySerializedString(content: string): string {
  const trimmed = content.trim()
  const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"')
  const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'")

  if ((!wrappedInDoubleQuotes && !wrappedInSingleQuotes) || trimmed.length < 2) {
    return content
  }

  const inner = trimmed.slice(1, -1)
  // Only unwrap when it looks like a serialized payload, not a normal quoted sentence.
  if (/\\[nrt"'\\]/.test(inner)) {
    return inner
  }

  return content
}

function keepPrintableChar(char: string): boolean {
  const code = char.charCodeAt(0)
  if (code === 0x09 || code === 0x0a) return true // tab and newline
  return code > 0x1f
}
