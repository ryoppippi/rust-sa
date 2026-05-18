import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'

export const API_ORIGIN = 'https://sa-api.localhost'

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: `${API_ORIGIN}/api/graphql`,
  }),
  cache: new InMemoryCache(),
  devtools: {
    enabled: import.meta.env.DEV,
    name: 'rust-sa',
  },
})
