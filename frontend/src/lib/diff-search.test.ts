import { describe, expect, it } from 'vitest'
import { buildDiffSearchHits } from './diff-search'

describe('buildDiffSearchHits', () => {
  it('matches file paths and patch lines case-insensitively', () => {
    const hits = buildDiffSearchHits(
      [{ path: 'src/GeneratedClient.ts' }, { path: 'README.md' }],
      new Map([
        ['src/GeneratedClient.ts', 'diff --git a/x b/x\n+Needle line'],
        ['README.md', '+nothing'],
      ]),
      'needle',
    )
    expect(hits.map((h) => [h.kind, h.path, h.rowIndex])).toEqual([
      ['line', 'src/GeneratedClient.ts', 1],
    ])
  })

  it('returns path hits before line hits in file order', () => {
    const hits = buildDiffSearchHits(
      [{ path: 'src/search.ts' }],
      new Map([['src/search.ts', '+search body']]),
      'search',
    )
    expect(hits.map((h) => h.kind)).toEqual(['path', 'line'])
  })

  it('returns no hits for blank queries', () => {
    expect(buildDiffSearchHits([{ path: 'a' }], new Map([['a', '+a']]), '  ')).toEqual([])
  })
})
