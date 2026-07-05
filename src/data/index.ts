import { DemoProvider } from './demoProvider'
import { SupabaseProvider } from './supabaseProvider'
import type { DataProvider } from './provider'

// Tolère les valeurs copiées-collées imparfaites : espaces, slash final,
// et surtout un chemin en trop (ex. l'URL REST « …supabase.co/rest/v1 »
// affichée par le tableau de bord) — seule l'origine du projet compte.
const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
let url = rawUrl
try {
  if (rawUrl) url = new URL(rawUrl).origin
} catch {
  // valeur illisible : on la laisse telle quelle, le mode démo prendra le relais
}
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/**
 * Sans configuration Supabase, l'application fonctionne entièrement en local
 * (mode démo) : idéal pour essayer, développer et tester.
 */
export const provider: DataProvider =
  url && anonKey ? new SupabaseProvider(url, anonKey) : new DemoProvider()
