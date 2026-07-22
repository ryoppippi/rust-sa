/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query Tree($repo: String!, $rev: String) {\n  tree(repo: $repo, rev: $rev)\n}": typeof types.TreeDocument,
    "query Comments($repo: String!, $rev: String!, $w: Boolean) {\n  comments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation AddComment($repo: String!, $rev: String!, $w: Boolean, $input: ReviewCommentInput!) {\n  addComment(repo: $repo, rev: $rev, w: $w, input: $input) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation DeleteComment($repo: String!, $rev: String!, $w: Boolean, $id: String!) {\n  deleteComment(repo: $repo, rev: $rev, w: $w, id: $id) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation ClearComments($repo: String!, $rev: String!, $w: Boolean) {\n  clearComments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}": typeof types.CommentsDocument,
    "query Files($rev: String!, $repo: String, $w: Boolean, $patch: String) {\n  files(rev: $rev, repo: $repo, w: $w, patch: $patch) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}": typeof types.FilesDocument,
    "query ListDir($path: String) {\n  listDir(path: $path) {\n    path\n    parent\n    entries {\n      name\n      isDir\n      isGitRepo\n      isHidden\n    }\n  }\n}": typeof types.ListDirDocument,
    "query Commits($limit: Int, $skip: Int, $repo: String!) {\n  commits(limit: $limit, skip: $skip, repo: $repo) {\n    sha\n    short\n    message\n    author\n    when\n    refs\n    parents\n  }\n}\n\nquery PreviewFiles($rev: String!, $repo: String!) {\n  files(rev: $rev, repo: $repo) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}\n\nquery Refs($repo: String!) {\n  branches(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n  tags(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n}": typeof types.CommitsDocument,
    "query Health {\n  health\n}": typeof types.HealthDocument,
    "query HomeData($limit: Int) {\n  recents {\n    repo\n    spec\n    visitedAt\n  }\n  repoCandidates(limit: $limit) {\n    path\n    source\n  }\n}\n\nquery ValidateRepo($repo: String!) {\n  validateRepo(repo: $repo) {\n    ok\n    path\n    message\n  }\n}\n\nmutation RecordRecent($repo: String!, $spec: String) {\n  recordRecent(repo: $repo, spec: $spec) {\n    repo\n    spec\n    visitedAt\n  }\n}\n\nmutation RemoveRecent($repo: String!) {\n  removeRecent(repo: $repo) {\n    repo\n    spec\n    visitedAt\n  }\n}": typeof types.HomeDataDocument,
    "query Preferences {\n  preferences {\n    theme\n  }\n}\n\nmutation SetPreferences($theme: String) {\n  setPreferences(theme: $theme) {\n    theme\n  }\n}": typeof types.PreferencesDocument,
};
const documents: Documents = {
    "query Tree($repo: String!, $rev: String) {\n  tree(repo: $repo, rev: $rev)\n}": types.TreeDocument,
    "query Comments($repo: String!, $rev: String!, $w: Boolean) {\n  comments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation AddComment($repo: String!, $rev: String!, $w: Boolean, $input: ReviewCommentInput!) {\n  addComment(repo: $repo, rev: $rev, w: $w, input: $input) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation DeleteComment($repo: String!, $rev: String!, $w: Boolean, $id: String!) {\n  deleteComment(repo: $repo, rev: $rev, w: $w, id: $id) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation ClearComments($repo: String!, $rev: String!, $w: Boolean) {\n  clearComments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}": types.CommentsDocument,
    "query Files($rev: String!, $repo: String, $w: Boolean, $patch: String) {\n  files(rev: $rev, repo: $repo, w: $w, patch: $patch) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}": types.FilesDocument,
    "query ListDir($path: String) {\n  listDir(path: $path) {\n    path\n    parent\n    entries {\n      name\n      isDir\n      isGitRepo\n      isHidden\n    }\n  }\n}": types.ListDirDocument,
    "query Commits($limit: Int, $skip: Int, $repo: String!) {\n  commits(limit: $limit, skip: $skip, repo: $repo) {\n    sha\n    short\n    message\n    author\n    when\n    refs\n    parents\n  }\n}\n\nquery PreviewFiles($rev: String!, $repo: String!) {\n  files(rev: $rev, repo: $repo) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}\n\nquery Refs($repo: String!) {\n  branches(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n  tags(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n}": types.CommitsDocument,
    "query Health {\n  health\n}": types.HealthDocument,
    "query HomeData($limit: Int) {\n  recents {\n    repo\n    spec\n    visitedAt\n  }\n  repoCandidates(limit: $limit) {\n    path\n    source\n  }\n}\n\nquery ValidateRepo($repo: String!) {\n  validateRepo(repo: $repo) {\n    ok\n    path\n    message\n  }\n}\n\nmutation RecordRecent($repo: String!, $spec: String) {\n  recordRecent(repo: $repo, spec: $spec) {\n    repo\n    spec\n    visitedAt\n  }\n}\n\nmutation RemoveRecent($repo: String!) {\n  removeRecent(repo: $repo) {\n    repo\n    spec\n    visitedAt\n  }\n}": types.HomeDataDocument,
    "query Preferences {\n  preferences {\n    theme\n  }\n}\n\nmutation SetPreferences($theme: String) {\n  setPreferences(theme: $theme) {\n    theme\n  }\n}": types.PreferencesDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Tree($repo: String!, $rev: String) {\n  tree(repo: $repo, rev: $rev)\n}"): (typeof documents)["query Tree($repo: String!, $rev: String) {\n  tree(repo: $repo, rev: $rev)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Comments($repo: String!, $rev: String!, $w: Boolean) {\n  comments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation AddComment($repo: String!, $rev: String!, $w: Boolean, $input: ReviewCommentInput!) {\n  addComment(repo: $repo, rev: $rev, w: $w, input: $input) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation DeleteComment($repo: String!, $rev: String!, $w: Boolean, $id: String!) {\n  deleteComment(repo: $repo, rev: $rev, w: $w, id: $id) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation ClearComments($repo: String!, $rev: String!, $w: Boolean) {\n  clearComments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}"): (typeof documents)["query Comments($repo: String!, $rev: String!, $w: Boolean) {\n  comments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation AddComment($repo: String!, $rev: String!, $w: Boolean, $input: ReviewCommentInput!) {\n  addComment(repo: $repo, rev: $rev, w: $w, input: $input) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation DeleteComment($repo: String!, $rev: String!, $w: Boolean, $id: String!) {\n  deleteComment(repo: $repo, rev: $rev, w: $w, id: $id) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}\n\nmutation ClearComments($repo: String!, $rev: String!, $w: Boolean) {\n  clearComments(repo: $repo, rev: $rev, w: $w) {\n    id\n    path\n    side\n    startLineNumber\n    endLineNumber\n    author\n    body\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Files($rev: String!, $repo: String, $w: Boolean, $patch: String) {\n  files(rev: $rev, repo: $repo, w: $w, patch: $patch) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}"): (typeof documents)["query Files($rev: String!, $repo: String, $w: Boolean, $patch: String) {\n  files(rev: $rev, repo: $repo, w: $w, patch: $patch) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ListDir($path: String) {\n  listDir(path: $path) {\n    path\n    parent\n    entries {\n      name\n      isDir\n      isGitRepo\n      isHidden\n    }\n  }\n}"): (typeof documents)["query ListDir($path: String) {\n  listDir(path: $path) {\n    path\n    parent\n    entries {\n      name\n      isDir\n      isGitRepo\n      isHidden\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Commits($limit: Int, $skip: Int, $repo: String!) {\n  commits(limit: $limit, skip: $skip, repo: $repo) {\n    sha\n    short\n    message\n    author\n    when\n    refs\n    parents\n  }\n}\n\nquery PreviewFiles($rev: String!, $repo: String!) {\n  files(rev: $rev, repo: $repo) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}\n\nquery Refs($repo: String!) {\n  branches(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n  tags(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n}"): (typeof documents)["query Commits($limit: Int, $skip: Int, $repo: String!) {\n  commits(limit: $limit, skip: $skip, repo: $repo) {\n    sha\n    short\n    message\n    author\n    when\n    refs\n    parents\n  }\n}\n\nquery PreviewFiles($rev: String!, $repo: String!) {\n  files(rev: $rev, repo: $repo) {\n    path\n    status\n    additions\n    deletions\n    visibleLines\n    visibleLinesSplit\n  }\n}\n\nquery Refs($repo: String!) {\n  branches(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n  tags(repo: $repo) {\n    name\n    shortSha\n    isCurrent\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Health {\n  health\n}"): (typeof documents)["query Health {\n  health\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query HomeData($limit: Int) {\n  recents {\n    repo\n    spec\n    visitedAt\n  }\n  repoCandidates(limit: $limit) {\n    path\n    source\n  }\n}\n\nquery ValidateRepo($repo: String!) {\n  validateRepo(repo: $repo) {\n    ok\n    path\n    message\n  }\n}\n\nmutation RecordRecent($repo: String!, $spec: String) {\n  recordRecent(repo: $repo, spec: $spec) {\n    repo\n    spec\n    visitedAt\n  }\n}\n\nmutation RemoveRecent($repo: String!) {\n  removeRecent(repo: $repo) {\n    repo\n    spec\n    visitedAt\n  }\n}"): (typeof documents)["query HomeData($limit: Int) {\n  recents {\n    repo\n    spec\n    visitedAt\n  }\n  repoCandidates(limit: $limit) {\n    path\n    source\n  }\n}\n\nquery ValidateRepo($repo: String!) {\n  validateRepo(repo: $repo) {\n    ok\n    path\n    message\n  }\n}\n\nmutation RecordRecent($repo: String!, $spec: String) {\n  recordRecent(repo: $repo, spec: $spec) {\n    repo\n    spec\n    visitedAt\n  }\n}\n\nmutation RemoveRecent($repo: String!) {\n  removeRecent(repo: $repo) {\n    repo\n    spec\n    visitedAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Preferences {\n  preferences {\n    theme\n  }\n}\n\nmutation SetPreferences($theme: String) {\n  setPreferences(theme: $theme) {\n    theme\n  }\n}"): (typeof documents)["query Preferences {\n  preferences {\n    theme\n  }\n}\n\nmutation SetPreferences($theme: String) {\n  setPreferences(theme: $theme) {\n    theme\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;