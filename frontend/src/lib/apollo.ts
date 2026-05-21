import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
  type FetchResult,
} from '@apollo/client'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { print, type DocumentNode } from 'graphql'

declare global {
  // Set by Tauri when the document runs inside its webview.
  var __TAURI_INTERNALS__: unknown
}

export function isTauri(): boolean {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.__TAURI_INTERNALS__)
}

export function getApiOrigin(): string {
  // Browser / portless dev. Tauri requests go through IPC and ignore this.
  return 'https://sa-api.localhost'
}

const tauriLink = new ApolloLink(
  (operation) =>
    new Observable<FetchResult>((observer) => {
      let cancelled = false
      ;(async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const result = await invoke<FetchResult>('graphql', {
            query: print(operation.query),
            variables: operation.variables ?? {},
            operationName: operation.operationName ?? null,
          })
          if (cancelled) return
          observer.next(result)
          observer.complete()
        } catch (err) {
          if (cancelled) return
          observer.error(err)
        }
      })()
      return () => {
        cancelled = true
      }
    }),
)

const httpLink = new HttpLink({
  uri: () => `${getApiOrigin()}/api/graphql`,
})

export const apolloClient = new ApolloClient({
  link: ApolloLink.split(isTauri, tauriLink, httpLink),
  cache: new InMemoryCache(),
  devtools: {
    enabled: import.meta.env.DEV,
    name: 'rust-sa',
  },
})

interface GraphQLResult<T> {
  data?: T
  errors?: Array<{ message: string }>
}

/**
 * Run a GraphQL operation outside the React tree (route loaders etc.) using
 * the same transport rules as Apollo: Tauri webview goes through IPC, browsers
 * fall back to portless-proxied HTTPS. Accepts a codegen-emitted
 * TypedDocumentNode so callers don't have to spell out the generics.
 */
export async function executeGraphQL<TData, TVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
): Promise<TData> {
  const operationName = operationNameOf(document)
  const query = print(document)
  return runGraphQL<TData>(query, variables as Record<string, unknown>, operationName)
}

async function runGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  operationName: string | undefined,
): Promise<T> {
  let result: GraphQLResult<T>
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    result = await invoke<GraphQLResult<T>>('graphql', {
      query,
      variables,
      operationName: operationName ?? null,
    })
  } else {
    const res = await fetch(`${getApiOrigin()}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables, operationName }),
    })
    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`)
    }
    result = (await res.json()) as GraphQLResult<T>
  }
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '))
  }
  if (!result.data) {
    throw new Error('GraphQL response missing data')
  }
  return result.data
}

function operationNameOf(document: DocumentNode): string | undefined {
  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition' && def.name?.value) {
      return def.name.value
    }
  }
  return undefined
}
