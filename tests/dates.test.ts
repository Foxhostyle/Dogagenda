/**
 * Tests des utilitaires de dates françaises (src/lib/dates.ts).
 * Repères fixes : 2026-06-29 est un lundi, 2026-07-01 un mercredi,
 * 2026-07-05 un dimanche — aucun test ne dépend de l’horloge réelle.
 */
import { describe, expect, it } from 'vitest'
import {
  addDaysStr,
  ageLabel,
  atTime,
  formatTime,
  mondayOf,
  relativeDayLabel,
  weekDates,
  weekdayIndex,
} from '../src/lib/dates'

describe('mondayOf', () => {
  it('renvoie le lundi de la semaine (la semaine française commence le lundi)', () => {
    expect(mondayOf('2026-07-01')).toBe('2026-06-29') // mercredi
    expect(mondayOf('2026-06-29')).toBe('2026-06-29') // déjà lundi
  })

  it('un dimanche appartient à la semaine du lundi précédent', () => {
    expect(mondayOf('2026-07-05')).toBe('2026-06-29')
  })

  it('accepte aussi un objet Date', () => {
    expect(mondayOf(new Date(2026, 6, 3, 14, 30))).toBe('2026-06-29') // vendredi 3 juillet
  })
})

describe('weekDates', () => {
  it('donne les 7 jours du lundi au dimanche', () => {
    expect(weekDates('2026-06-29')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ])
  })
})

describe('weekdayIndex', () => {
  it('lundi = 0 … dimanche = 6', () => {
    expect(weekdayIndex('2026-06-29')).toBe(0) // lundi
    expect(weekdayIndex('2026-07-01')).toBe(2) // mercredi
    expect(weekdayIndex('2026-07-05')).toBe(6) // dimanche
  })
})

describe('atTime', () => {
  it('combine date calendaire et heure locale', () => {
    const d = atTime('2026-07-01', '19:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(19)
    expect(d.getMinutes()).toBe(30)
  })
})

describe('formatTime', () => {
  it('utilise la convention française « 7h » / « 19h30 »', () => {
    expect(formatTime('07:00')).toBe('7h')
    expect(formatTime('19:30')).toBe('19h30')
    expect(formatTime('09:05')).toBe('9h05')
  })
})

describe('ageLabel', () => {
  const now = new Date(2026, 6, 1) // 1er juillet 2026

  it('compte en années à partir d’un an, avec accord du pluriel', () => {
    expect(ageLabel('2023-03-15', now)).toBe('3 ans')
    expect(ageLabel('2025-06-20', now)).toBe('1 an')
  })

  it('compte en mois avant un an, jamais « 0 mois »', () => {
    expect(ageLabel('2025-12-01', now)).toBe('7 mois')
    expect(ageLabel('2026-06-20', now)).toBe('1 mois')
  })
})

describe('relativeDayLabel', () => {
  const now = new Date(2026, 6, 1, 15, 0) // mercredi 1er juillet, 15h

  it('aujourd’hui / demain / hier', () => {
    expect(relativeDayLabel('2026-07-01', now)).toBe("Aujourd'hui")
    expect(relativeDayLabel('2026-07-02', now)).toBe('Demain')
    expect(relativeDayLabel('2026-06-30', now)).toBe('Hier')
  })

  it('sinon, le jour en toutes lettres', () => {
    expect(relativeDayLabel('2026-07-04', now)).toBe('samedi 4 juillet')
  })
})

describe('addDaysStr', () => {
  it('franchit les frontières de mois dans les deux sens', () => {
    expect(addDaysStr('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDaysStr('2026-07-01', -1)).toBe('2026-06-30')
    expect(addDaysStr('2026-06-29', 7)).toBe('2026-07-06')
  })
})
