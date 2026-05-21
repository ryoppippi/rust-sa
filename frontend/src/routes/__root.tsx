import { ApolloProvider } from '@apollo/client/react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { HeadContent, Outlet, Scripts, createRootRoute, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { apolloClient } from '../lib/apollo'
import { installA11yPatches } from '../lib/a11y-patches'
import { UrlBar } from '../components/url-bar'
import { ErrorScreen } from '../components/error-screen'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        name: 'description',
        content:
          'rust-sa — local git diff reviewer. Browse hunks, leave comments, and copy AI-ready prompts directly from your working tree.',
      },
      {
        title: 'rust-sa',
      },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootRoute,
  errorComponent: ErrorScreen,
  shellComponent: RootDocument,
})

function RootRoute() {
  const search = useSearch({ strict: false }) as { repo?: unknown }
  const repo = typeof search.repo === 'string' ? search.repo : undefined

  // Drive document.title from React state; the tauri window watches it via
  // on_document_title_changed and mirrors it to the OS title bar.
  useEffect(() => {
    document.title = repo ? `rust-sa - ${repo}` : 'rust-sa'
  }, [repo])

  return (
    <>
      <UrlBar />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('react-grab')
    }
    return installA11yPatches()
  }, [])
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col h-screen overflow-hidden">
        <ApolloProvider client={apolloClient}>
          <HotkeysProvider>{children}</HotkeysProvider>
        </ApolloProvider>
        <Scripts />
      </body>
    </html>
  )
}
