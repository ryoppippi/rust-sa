// Lighthouse / axe a11y patches for third-party shadow-DOM widgets
// (@pierre/trees and @pierre/diffs). The libraries render perfectly fine
// visually, but their internal markup violates a few axe rules that we cannot
// fix at the source. We use MutationObservers on the document body to keep
// every present-and-future tree/diffs container compliant.

const PATCHED = '__rustSaA11yPatched' as const
type PatchedHost = HTMLElement & { [PATCHED]?: MutationObserver }

let installed = false
let teardown: (() => void) | null = null

export function installA11yPatches(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  if (installed && teardown) return teardown
  installed = true

  const observers = new Set<MutationObserver>()
  const cleanups = new Set<() => void>()

  const patchFileTree = (host: PatchedHost) => {
    if (host[PATCHED]) return
    const root = host.shadowRoot
    if (!root) return
    adoptTreeContrastSheet(root)
    const apply = () => {
      for (const el of root.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
        const path = el.getAttribute('data-item-path') ?? ''
        const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
        const leaf = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
        const status = el.getAttribute('data-item-git-status')
        const label = status ? `${leaf}, ${status}` : leaf
        if (leaf && el.getAttribute('aria-label') !== label) {
          el.setAttribute('aria-label', label)
        }
        for (const section of el.querySelectorAll<HTMLElement>(
          '[data-item-section="content"], [data-item-section="git"], [data-item-section="decoration"]',
        )) {
          if (section.getAttribute('aria-hidden') !== 'true') {
            section.setAttribute('aria-hidden', 'true')
          }
        }
      }
      for (const tree of root.querySelectorAll<HTMLElement>('[role="tree"]')) {
        const ids: string[] = []
        for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
          if (!item.id) item.id = `pst-treeitem-${autoId++}`
          ids.push(item.id)
        }
        const next = ids.join(' ')
        if (tree.getAttribute('aria-owns') !== next) {
          tree.setAttribute('aria-owns', next)
        }
      }
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
    host[PATCHED] = mo
    observers.add(mo)
  }

  const patchDiffs = (host: PatchedHost) => {
    if (host[PATCHED]) return
    const root = host.shadowRoot
    if (!root) return
    const apply = () => {
      for (const el of root.querySelectorAll<HTMLElement>(
        '[data-expand-button]:not([aria-label])',
      )) {
        const dir = el.hasAttribute('data-expand-up')
          ? 'up'
          : el.hasAttribute('data-expand-down')
            ? 'down'
            : 'both'
        el.setAttribute('aria-label', `Expand diff context ${dir}`)
      }
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(root, { childList: true, subtree: true })
    host[PATCHED] = mo
    observers.add(mo)
  }

  const sweep = () => {
    for (const host of document.querySelectorAll<PatchedHost>('file-tree-container')) {
      patchFileTree(host)
    }
    for (const host of document.querySelectorAll<PatchedHost>('diffs-container')) {
      patchDiffs(host)
    }
  }
  sweep()
  // Poll shortly after mount for late-attached shadow roots (custom elements
  // can attach shadow asynchronously). The body-level observer alone misses
  // hosts that were already in the DOM but had no shadowRoot yet.
  let polls = 0
  const pollId = window.setInterval(() => {
    sweep()
    if (++polls > 40) window.clearInterval(pollId)
  }, 150)
  cleanups.add(() => window.clearInterval(pollId))

  const docObs = new MutationObserver(sweep)
  docObs.observe(document.body, { childList: true, subtree: true })
  observers.add(docObs)

  teardown = () => {
    for (const cleanup of cleanups) cleanup()
    for (const mo of observers) mo.disconnect()
    installed = false
    teardown = null
  }
  return teardown
}

let autoId = 0

let treeContrastSheetCache: CSSStyleSheet | null = null
function getTreeContrastSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null
  if (treeContrastSheetCache) return treeContrastSheetCache
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    [data-truncate-content], [data-truncate-content] * {
      color: var(--trees-fg-override, var(--ink, currentColor)) !important;
    }
  `)
  treeContrastSheetCache = sheet
  return sheet
}

function adoptTreeContrastSheet(root: ShadowRoot) {
  const sheet = getTreeContrastSheet()
  if (!sheet) return
  if (root.adoptedStyleSheets.includes(sheet)) return
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
}
