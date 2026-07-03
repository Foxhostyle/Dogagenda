import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  emoji?: string
  tone: 'default' | 'error'
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, emoji?: string) => void
  error: (text: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set) => {
  const add = (text: string, emoji: string | undefined, tone: Toast['tone']) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, text, emoji, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  }
  return {
    toasts: [],
    push: (text, emoji) => add(text, emoji, 'default'),
    error: (text) => add(text, undefined, 'error'),
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

/** Exécute une mutation en affichant l'erreur éventuelle en toast. */
export async function tryAction(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    useToasts.getState().error(e instanceof Error ? e.message : 'Une erreur est survenue.')
    return false
  }
}
