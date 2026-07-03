import { DemoProvider } from './demoProvider'
import { SupabaseProvider } from './supabaseProvider'
import type { DataProvider } from './provider'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Sans configuration Supabase, l'application fonctionne entièrement en local
 * (mode démo) : idéal pour essayer, développer et tester.
 */
export const provider: DataProvider =
  url && anonKey ? new SupabaseProvider(url, anonKey) : new DemoProvider()
