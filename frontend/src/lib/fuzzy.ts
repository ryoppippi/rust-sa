export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  let score = 0
  let j = 0
  let streak = 0
  let prevIdx = -1
  for (let i = 0; i < h.length && j < n.length; i++) {
    if (h[i] === n[j]) {
      score += 1
      if (i === 0) score += 2
      else if (h[i - 1] === '/' || h[i - 1] === '-' || h[i - 1] === '_' || h[i - 1] === '.')
        score += 2
      if (prevIdx === i - 1) {
        streak += 1
        score += streak
      } else {
        streak = 0
      }
      prevIdx = i
      j++
    }
  }
  if (j < n.length) return 0
  if (h.startsWith(n)) score += 5
  return score
}
