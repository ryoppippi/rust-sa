import { ApolloProvider } from '@apollo/client/react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { apolloClient } from '../lib/apollo'

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
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('react-grab')
    }
  }, [])
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ApolloProvider client={apolloClient}>
          <HotkeysProvider>{children}</HotkeysProvider>
        </ApolloProvider>
        <Scripts />
      </body>
    </html>
  )
}
