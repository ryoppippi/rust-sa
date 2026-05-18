const SHA_LIKE = /^[0-9a-f]{7,}$/i

export function shortSha(s: string): string {
  return SHA_LIKE.test(s) ? s.slice(0, 7) : s
}

/**
 * Shorten every SHA-looking ref inside a compare spec. Handles single refs
 * ("HEAD", "abcdef..."), two-dot ranges ("abc..def") and three-dot ranges
 * ("abc...def"); non-SHA tokens like "WORKING" or branch names pass through.
 */
export function shortenSpec(spec: string): string {
  for (const sep of ['...', '..'] as const) {
    const idx = spec.indexOf(sep)
    if (idx >= 0) {
      const base = spec.slice(0, idx)
      const head = spec.slice(idx + sep.length)
      return `${shortSha(base)}${sep}${shortSha(head)}`
    }
  }
  return shortSha(spec)
}
