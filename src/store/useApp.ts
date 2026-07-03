import { create } from 'zustand'
import { provider } from '../data'
import type { AppSnapshot, Member, Session } from '../domain/types'

type Phase = 'booting' | 'anonymous' | 'ready'

interface AppState {
  phase: Phase
  session: Session | null
  snap: AppSnapshot | null
  /** Incrémenté chaque minute : recalcule les statuts dépendants de l'heure. */
  tick: number
  init: () => Promise<void>
  refresh: () => Promise<void>
  /** À appeler après createHousehold / joinHousehold / loadDemoData / switchMember. */
  adoptSession: (session: Session) => Promise<void>
  signOut: () => Promise<void>
}

let started = false

export const useApp = create<AppState>((set, get) => ({
  phase: 'booting',
  session: null,
  snap: null,
  tick: 0,

  init: async () => {
    if (started) return
    started = true
    provider.subscribe(() => {
      if (get().session) void get().refresh()
    })
    setInterval(() => set((s) => ({ tick: s.tick + 1 })), 60_000)
    try {
      const session = await provider.getSession()
      if (!session) {
        set({ phase: 'anonymous', session: null, snap: null })
        return
      }
      const snap = await provider.load()
      set({ phase: 'ready', session, snap })
    } catch {
      set({ phase: 'anonymous', session: null, snap: null })
    }
  },

  refresh: async () => {
    try {
      const session = await provider.getSession()
      if (!session) {
        set({ phase: 'anonymous', session: null, snap: null })
        return
      }
      const snap = await provider.load()
      set({ phase: 'ready', session, snap })
    } catch {
      // Réseau momentanément indisponible : on garde le dernier snapshot.
    }
  },

  adoptSession: async (session) => {
    const snap = await provider.load()
    set({ phase: 'ready', session, snap })
  },

  signOut: async () => {
    await provider.leave()
    set({ phase: 'anonymous', session: null, snap: null })
  },
}))

/** Membre actif (celui qui utilise l'appareil). */
export function useActiveMember(): Member | null {
  const { session, snap } = useApp()
  if (!session || !snap) return null
  return snap.members.find((m) => m.id === session.memberId) ?? null
}

/** Résolution robuste d'un membre par id (membre supprimé → placeholder). */
export function memberById(snap: AppSnapshot | null, id: string | undefined): Member | null {
  if (!snap || !id) return null
  return snap.members.find((m) => m.id === id) ?? null
}
