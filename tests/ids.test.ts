/**
 * Tests des codes d’invitation (src/lib/ids.ts).
 */
import { describe, expect, it } from 'vitest'
import { newInviteCode, normalizeInviteCode } from '../src/lib/ids'

describe('newInviteCode', () => {
  it('produit 6 caractères sans lettres ambiguës (0/O, 1/I/L exclus), sur 200 tirages', () => {
    const valid = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode()
      expect(code).toHaveLength(6)
      expect(code).toMatch(valid)
    }
  })
})

describe('normalizeInviteCode', () => {
  it('nettoie la saisie : espaces, casse, tirets', () => {
    expect(normalizeInviteCode(' wint24 ')).toBe('WINT24')
    expect(normalizeInviteCode('win-t24')).toBe('WINT24')
    expect(normalizeInviteCode('W I N T 2 4')).toBe('WINT24')
    expect(normalizeInviteCode('')).toBe('')
  })
})
