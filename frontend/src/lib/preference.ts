import { useEffect, useState } from 'react'

export function usePreference<T extends string>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(key)
    if (raw) setValue(raw as T)
  }, [key])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
  }, [key, value])

  return [value, setValue]
}

export function useRootAttribute(name: string, value: string) {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute(name, value)
    return () => root.removeAttribute(name)
  }, [name, value])
}
