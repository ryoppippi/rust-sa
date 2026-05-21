import { useMutation as apolloUseMutation, useQuery as apolloUseQuery } from '@apollo/client/react'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import type { OperationVariables } from '@apollo/client'

/**
 * Wrapper around Apollo's useQuery that takes only a TypedDocumentNode and
 * surfaces the underlying `TData` directly on the result. Two reasons:
 *
 * 1. Apollo's `DocumentNode | TypedDocumentNode<TData, TVariables>` union
 *    causes TypeScript to pick the bare DocumentNode arm, dropping TData
 *    inference and forcing callers to spell out `useQuery<TData>` generics.
 *    Constraining the document parameter to `TypedDocumentNode<...>` fixes it.
 * 2. Apollo 4 splits `data` into `complete | streaming | partial | undefined`
 *    variants whose Streaming/Partial recursively mark every field optional.
 *    This app doesn't use `@defer`, so we collapse the union back to plain
 *    `TData | undefined` to match the pre-v4 shape every call site assumes.
 */
export type TypedQueryResult<TData, TVariables extends OperationVariables> = Omit<
  apolloUseQuery.Result<TData, TVariables>,
  'data'
> & { data: TData | undefined }

export function useQuery<TData, TVariables extends OperationVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  options?: apolloUseQuery.Options<TData, TVariables>,
): TypedQueryResult<TData, TVariables> {
  const result = apolloUseQuery<TData, TVariables>(
    document,
    (options ?? {}) as apolloUseQuery.Options<TData, TVariables>,
  )
  return result as unknown as TypedQueryResult<TData, TVariables>
}

export function useMutation<TData, TVariables extends OperationVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  options?: apolloUseMutation.Options<TData, TVariables>,
): ReturnType<typeof apolloUseMutation<TData, TVariables>> {
  return apolloUseMutation<TData, TVariables>(document, options)
}
