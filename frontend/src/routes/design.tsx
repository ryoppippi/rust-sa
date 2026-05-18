import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { DialogTrigger } from 'react-aria-components'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { Segmented, SegmentedItem } from '#/components/ui/segmented'
import { Sheet } from '#/components/ui/sheet'
import { Tag } from '#/components/ui/tag'

export const Route = createFileRoute('/design')({
  component: DesignPage,
})

function DesignPage() {
  const [mode, setMode] = useState<'unified' | 'split'>('unified')

  return (
    <div className="min-h-full bg-bg text-ink font-sans overflow-y-auto">
      <header className="border-b border-hairline px-16 pt-14 pb-6">
        <h1 className="m-0 font-serif text-6xl leading-none tracking-tight font-normal">rust-sa</h1>
        <p className="mt-2 max-w-md text-mute text-sm leading-relaxed">
          Design system — warm paper canvas, mono-forward chrome, oxide-rust accent.
        </p>
      </header>

      <Section tag="01" title="Buttons">
        <Group label="primary / secondary / ghost">
          <Button variant="primary">primary</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="ghost">ghost</Button>
        </Group>
        <Group label="sizes">
          <Button size="sm">small</Button>
          <Button size="md">medium</Button>
        </Group>
        <Group label="disabled">
          <Button isDisabled>disabled</Button>
        </Group>
      </Section>

      <Section tag="02" title="Segmented · pills">
        <Group label="ToggleButtonGroup">
          <Segmented
            selectedKeys={[mode]}
            onSelectionChange={(keys) => {
              const first = [...keys][0]
              if (first === 'unified' || first === 'split') setMode(first)
            }}
          >
            <SegmentedItem id="unified">unified</SegmentedItem>
            <SegmentedItem id="split">split</SegmentedItem>
          </Segmented>
          <Tag tone="rust">HEAD</Tag>
          <Tag tone="amber">working</Tag>
          <Tag tone="moss">viewed</Tag>
          <Tag tone="neutral">main</Tag>
        </Group>
      </Section>

      <Section tag="03" title="Keys · overlay">
        <Group label="kbd">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>?</Kbd>
        </Group>
        <Group label="Sheet (Dialog)">
          <DialogTrigger>
            <Button variant="primary">Open help ?</Button>
            <Sheet title="Keybindings" hint="vim-flavoured">
              <div className="grid grid-cols-2 gap-y-3 gap-x-8">
                <KeyRow label="next line" keys={['j']} />
                <KeyRow label="prev line" keys={['k']} />
                <KeyRow label="next hunk" keys={['n']} />
                <KeyRow label="prev hunk" keys={['p']} />
                <KeyRow label="next file" keys={[']']} />
                <KeyRow label="prev file" keys={['[']} />
                <KeyRow label="help" keys={['?']} />
              </div>
            </Sheet>
          </DialogTrigger>
        </Group>
      </Section>

      <Section tag="04" title="Palette">
        <Group label="surfaces">
          <Swatch
            name="bg"
            value="#f4efe6"
            style={{ background: '#f4efe6', color: '#1a1815' }}
            bordered
          />
          <Swatch
            name="bg-soft"
            value="#ede6d6"
            style={{ background: '#ede6d6', color: '#1a1815' }}
          />
          <Swatch
            name="bg-card"
            value="#e6dec9"
            style={{ background: '#e6dec9', color: '#1a1815' }}
          />
          <Swatch name="dark" value="#1c1a17" style={{ background: '#1c1a17', color: '#ece4d2' }} />
        </Group>
        <Group label="accent">
          <Swatch name="rust" value="#a04a2a" style={{ background: '#a04a2a', color: '#fff8ee' }} />
          <Swatch
            name="rust-deep"
            value="#7a3520"
            style={{ background: '#7a3520', color: '#fff8ee' }}
          />
          <Swatch name="moss" value="#4f7a6a" style={{ background: '#4f7a6a', color: '#fff8ee' }} />
          <Swatch
            name="crimson"
            value="#a83a3a"
            style={{ background: '#a83a3a', color: '#fff8ee' }}
          />
        </Group>
      </Section>
    </div>
  )
}

function Section({
  tag,
  title,
  children,
}: {
  tag: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-dashed border-hairline px-16 py-12">
      <div className="mb-7 flex items-baseline gap-4">
        <span className="border-r border-hairline pr-3 mr-1 font-mono text-xs uppercase tracking-widest text-faint">
          {tag}
        </span>
        <h2 className="m-0 font-serif text-3xl font-normal tracking-tight">{title}</h2>
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-xs uppercase tracking-widest text-faint">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function KeyRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between text-ink-2 text-sm">
      <span>{label}</span>
      <span className="inline-flex gap-1">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
    </div>
  )
}

function Swatch({
  name,
  value,
  style,
  bordered,
}: {
  name: string
  value: string
  style: React.CSSProperties
  bordered?: boolean
}) {
  return (
    <div
      className={
        'flex min-h-16 w-40 flex-col justify-end gap-1 rounded-sm px-3 pt-3 pb-2.5 font-mono' +
        (bordered ? ' border border-hairline' : '')
      }
      style={style}
    >
      <span className="text-xs font-medium">{name}</span>
      <span className="text-xs opacity-70 tracking-wide">{value}</span>
    </div>
  )
}
