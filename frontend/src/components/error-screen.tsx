import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { isTauri } from '#/lib/apollo'

export function ErrorScreen({ error, info, reset }: ErrorComponentProps) {
  const [copied, setCopied] = useState(false)

  const err = error instanceof Error ? error : new Error(String(error))
  const url = typeof window !== 'undefined' ? window.location.href : 'unknown'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const platform = isTauri() ? 'tauri' : 'browser'

  const diagnostic = [
    `[rust-sa diagnostic]`,
    `time: ${new Date().toISOString()}`,
    `platform: ${platform}`,
    `url: ${url}`,
    `user-agent: ${ua}`,
    '',
    `error: ${err.name}: ${err.message}`,
    err.stack ? `\nstack:\n${err.stack}` : '',
    info?.componentStack ? `\ncomponent stack:\n${info.componentStack.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable inside the tauri webview without a
      // permission entry. Fall back to a selection prompt.
      const ok = window.prompt('Copy this diagnostic:', diagnostic)
      if (ok !== null) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-8 bg-bg text-ink">
      <header className="mb-6">
        <h1 className="m-0 font-serif text-3xl font-normal tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-2 font-mono text-xs text-mute">
          rust-sa hit an error rendering this view. Copy the diagnostic below
          when reporting it so we can reproduce.
        </p>
      </header>

      <section className="mb-6 rounded-sm border border-hairline bg-bg-card p-4 font-mono text-xs leading-relaxed">
        <div className="text-crimson font-medium">
          {err.name}: {err.message}
        </div>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-mute">
          <dt>platform</dt>
          <dd className="text-ink">{platform}</dd>
          <dt>url</dt>
          <dd className="text-ink break-all">{url}</dd>
        </dl>
      </section>

      <div className="mb-4 flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 border border-hairline px-3 py-1.5 rounded-sm text-xs font-mono bg-bg-card hover:bg-bg-strong cursor-pointer"
        >
          {copied ? '✓ copied' : 'copy diagnostic'}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 border border-hairline px-3 py-1.5 rounded-sm text-xs font-mono bg-bg-card hover:bg-bg-strong cursor-pointer"
        >
          retry
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = '/'
          }}
          className="inline-flex items-center gap-1.5 border border-hairline px-3 py-1.5 rounded-sm text-xs font-mono bg-bg-card hover:bg-bg-strong cursor-pointer"
        >
          home
        </button>
      </div>

      <details className="rounded-sm border border-hairline bg-bg-card">
        <summary className="px-3 py-2 cursor-pointer font-mono text-xs text-mute hover:text-ink">
          diagnostic
        </summary>
        <pre className="m-0 p-4 font-mono text-[11px] leading-relaxed text-ink whitespace-pre-wrap break-all border-t border-hairline">
          {diagnostic}
        </pre>
      </details>
    </div>
  )
}
