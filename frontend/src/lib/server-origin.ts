export const SERVER_ORIGIN =
  typeof window === 'undefined'
    ? process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:4000'
    : 'http://127.0.0.1:4000'
