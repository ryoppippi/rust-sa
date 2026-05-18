export const SERVER_ORIGIN =
  typeof window === 'undefined'
    ? (process.env.BACKEND_ORIGIN ?? 'https://sa-api.localhost')
    : 'https://sa-api.localhost'
