import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client'

export const API_ORIGIN = 'http://localhost:4000'

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: `${API_ORIGIN}/api/graphql`,
  }),
  cache: new InMemoryCache(),
})