import { useMutation, useQuery } from '#/lib/typed-query'
import { PreferencesDocument, SetPreferencesDocument } from '#/graphql/generated/graphql'
import type { Theme } from '#/components/top-bar'

function asTheme(t: string | undefined): Theme {
  return t === 'dark' ? 'dark' : 'light'
}

export function useThemePreference(): [Theme, (next: Theme) => void] {
  const { data } = useQuery(PreferencesDocument, { fetchPolicy: 'cache-first' })
  const [mutate] = useMutation(SetPreferencesDocument, {
    refetchQueries: [{ query: PreferencesDocument }],
    awaitRefetchQueries: true,
  })
  const theme = asTheme(data?.preferences.theme)
  const setTheme = (next: Theme) => {
    mutate({ variables: { theme: next } })
  }
  return [theme, setTheme]
}
