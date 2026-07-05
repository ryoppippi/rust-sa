import { useMutation, useQuery } from '#/lib/typed-query'
import {
  AddCommentDocument,
  ClearCommentsDocument,
  CommentsDocument,
  DeleteCommentDocument,
} from '#/graphql/generated/graphql'

export type Side = 'deletions' | 'additions'

export interface Comment {
  id: string
  path: string
  side: Side
  startLineNumber: number
  endLineNumber: number
  author: string
  body: string
  createdAt: string
}

export interface CommentsState {
  comments: Comment[]
  add: (input: Omit<Comment, 'id' | 'createdAt'>) => void
  remove: (id: string) => void
  clear: () => void
}

function toComments(raw: readonly { side: string }[] | undefined): Comment[] {
  return (raw ?? []).filter((c): c is Comment => c.side === 'additions' || c.side === 'deletions')
}

export function useComments(rev: string, repo: string | undefined, w?: boolean): CommentsState {
  const { data } = useQuery(CommentsDocument, {
    variables: { repo: repo ?? '', rev, w },
    fetchPolicy: 'cache-and-network',
    skip: !repo,
  })
  const [addMutation] = useMutation(AddCommentDocument)
  const [deleteMutation] = useMutation(DeleteCommentDocument)
  const [clearMutation] = useMutation(ClearCommentsDocument)
  return {
    comments: toComments(data?.comments),
    add: (input) => {
      if (!repo) return
      addMutation({
        variables: { repo, rev, w, input },
        update: (cache, result) => {
          const comments = result.data?.addComment
          if (comments)
            cache.writeQuery({
              query: CommentsDocument,
              variables: { repo, rev, w },
              data: { comments },
            })
        },
      })
    },
    remove: (id) => {
      if (!repo) return
      deleteMutation({
        variables: { repo, rev, w, id },
        update: (cache, result) => {
          const comments = result.data?.deleteComment
          if (comments)
            cache.writeQuery({
              query: CommentsDocument,
              variables: { repo, rev, w },
              data: { comments },
            })
        },
      })
    },
    clear: () => {
      if (!repo) return
      clearMutation({
        variables: { repo, rev, w },
        update: (cache, result) => {
          const comments = result.data?.clearComments
          if (comments)
            cache.writeQuery({
              query: CommentsDocument,
              variables: { repo, rev, w },
              data: { comments },
            })
        },
      })
    },
  }
}
