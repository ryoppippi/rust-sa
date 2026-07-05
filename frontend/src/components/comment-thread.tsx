import { Copy, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { Comment } from '#/lib/comments'

export interface CommentThreadProps {
  comments: Comment[]
  onDelete?: (id: string) => void
}

function lineRangeLabel(c: Comment): string {
  return c.startLineNumber === c.endLineNumber
    ? `L${c.startLineNumber}`
    : `L${c.startLineNumber}–L${c.endLineNumber}`
}

function promptFor(c: Comment): string {
  return `Re: ${c.path}:${lineRangeLabel(c)}\n${c.body}`
}

export function CommentThread({ comments, onDelete }: CommentThreadProps) {
  if (comments.length === 0) return null
  const first = comments[0]
  return (
    <div className="bg-bg-soft border-y border-hairline-soft px-4 py-2.5 pl-15 font-sans text-sm flex flex-col gap-2">
      <div className="font-mono text-xs uppercase tracking-widest text-mute">
        {lineRangeLabel(first)}
      </div>
      {comments.map((c) => {
        const isClaude = c.author.includes('claude')
        return (
          <div
            key={c.id}
            className="bg-bg border border-hairline rounded-sm px-3 py-2.5 flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-1.5 font-mono text-xs text-mute">
              <span className={cnAuthor(isClaude) + ' inline-flex items-center gap-1'}>
                {isClaude && <Sparkles size={16} aria-hidden="true" />}
                {c.author}
              </span>
              <span>· {timeAgo(c.createdAt)}</span>
            </div>
            <div className="text-sm leading-normal text-ink-2 whitespace-pre-wrap">{c.body}</div>
            <div className="flex items-center gap-2">
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onPress={() => navigator.clipboard?.writeText(promptFor(c))}
              >
                <Copy size={16} aria-hidden="true" />
                copy prompt
              </Button>
              {onDelete && (
                <Button variant="ghost" size="sm" onPress={() => onDelete(c.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                  delete
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function cnAuthor(isClaude: boolean): string {
  return isClaude ? 'text-rust font-medium' : 'text-ink font-medium'
}

function timeAgo(iso: string): string {
  const value = /^\d+$/.test(iso) ? Number(iso) : new Date(iso).getTime()
  const sec = Math.floor((Date.now() - value) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
