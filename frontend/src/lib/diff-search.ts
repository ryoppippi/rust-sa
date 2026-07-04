export interface DiffSearchFile {
  path: string
}

export interface DiffSearchHit {
  id: string
  kind: 'path' | 'line'
  path: string
  rowIndex: number
  preview: string
}

export function buildDiffSearchHits(
  files: readonly DiffSearchFile[],
  patches: ReadonlyMap<string, string>,
  query: string,
): DiffSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: DiffSearchHit[] = []
  for (const file of files) {
    if (file.path.toLowerCase().includes(needle)) {
      hits.push({
        id: `${file.path}:path`,
        kind: 'path',
        path: file.path,
        rowIndex: 0,
        preview: file.path,
      })
    }
    const patch = patches.get(file.path)
    if (!patch) continue
    const lines = patch.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      if (line.toLowerCase().includes(needle)) {
        hits.push({
          id: `${file.path}:line:${i}`,
          kind: 'line',
          path: file.path,
          rowIndex: i,
          preview: line.trim() || line,
        })
      }
    }
  }
  return hits
}
