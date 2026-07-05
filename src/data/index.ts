import { DemoProvider } from './demoProvider'
import { SupabaseProvider } from './supabaseProvider'
import type { DataProvider } from './provider'

// Tolère les valeurs copiées-collées imparfaites : espaces, retours à la
// ligne, slash final (« https://xxx.supabase.co/ » casserait les URL d'API).
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/**
 * Sans configuration Supabase, l'application fonctionne entièrement en local
 * (mode démo) : idéal pour essayer, développer et tester.
 */
export const provider: DataProvider =
  url && anonKey ? new SupabaseProvider(url, anonKey) : new DemoProvider()
