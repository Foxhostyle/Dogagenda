/**
 * Tests de la logique métier pure (src/domain/logic.ts).
 *
 * Repères calendaires fixes :
 * - 2026-06-29 est un lundi, 2026-07-01 un mercredi, 2026-07-05 un dimanche.
 * - 2026-07-13 est le lundi de la semaine suivante (+2 semaines après le 29/06).
 */
import { describe, expect, it } from 'vitest'
import {
  activeCarePeriod,
  activeTemplates,
  applyWeekTemplate,
  carePeriodConflicts,
  carePeriodsOfWeek,
  currentCascadeTarget,
  daySlotViews,
  duplicateWeekAssignments,
  exhaustedSwaps,
  findWalkSlot,
  galleryItems,
  membersByPriority,
  nextCarePeriod,
  nextCascadeTarget,
  slotKey,
  swapsTargeting,
  validSlotTimes,
  weekAssignments,
  weekTemplateFromWeek,
} from '../src/domain/logic'
import { atTime } from '../src/lib/dates'
import type {
  CarePeriod,
  Member,
  Message,
  SlotTemplate,
  SwapRequest,
  WalkSlot,
} from '../src/domain/types'

// ---------------------------------------------------------------------------
// Fabriques de fixtures
// ---------------------------------------------------------------------------

let seq = 0
const nextId = (prefix: string) => `${prefix}${++seq}`

function makeMember(over: Partial<Member> = {}): Member {
  return {
    id: nextId('m'),
    householdId: 'h1',
    name: 'Bastien',
    emoji: '🦊',
    color: '#578764',
    role: 'member',
    priorityRank: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function makeTemplate(over: Partial<SlotTemplate> = {}): SlotTemplate {
  return {
    id: nextId('t'),
    householdId: 'h1',
    name: 'Matin',
    emoji: '🌅',
    startTime: '07:00',
    endTime: '09:00',
    sortOrder: 0,
    active: true,
    ...over,
  }
}

function makeSlot(over: Partial<WalkSlot> = {}): WalkSlot {
  return {
    id: nextId('w'),
    petId: 'p1',
    date: '2026-07-01',
    slotTemplateId: 't-matin',
    status: 'pending',
    ...over,
  }
}

function makePeriod(over: Partial<CarePeriod> = {}): CarePeriod {
  return {
    id: nextId('cp'),
    petId: 'p1',
    memberId: 'm1',
    startAt: '2026-07-01T18:00:00.000Z',
    endAt: '2026-07-03T09:00:00.000Z',
    ...over,
  }
}

function makeSwap(over: Partial<SwapRequest> = {}): SwapRequest {
  return {
    id: nextId('sw'),
    householdId: 'h1',
    walkSlotDate: '2026-07-01',
    walkSlotTemplateId: 't-matin',
    requesterId: 'm1',
    status: 'open',
    cascade: [],
    createdAt: '2026-07-01T08:00:00.000Z',
    ...over,
  }
}

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: nextId('msg'),
    householdId: 'h1',
    authorId: 'm1',
    kind: 'user',
    text: 'Coucou',
    createdAt: '2026-07-01T10:00:00.000Z',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Créneaux de promenade
// ---------------------------------------------------------------------------

describe('slotKey / findWalkSlot', () => {
  it('compose une clé stable date|template', () => {
    expect(slotKey('2026-07-01', 't-matin')).toBe('2026-07-01|t-matin')
  })

  it('retrouve la ligne correspondant au jour et au créneau', () => {
    const target = makeSlot({ date: '2026-07-01', slotTemplateId: 't-soir' })
    const slots = [
      makeSlot({ date: '2026-07-01', slotTemplateId: 't-matin' }),
      makeSlot({ date: '2026-06-30', slotTemplateId: 't-soir' }),
      target,
    ]
    expect(findWalkSlot(slots, '2026-07-01', 't-soir')).toBe(target)
    expect(findWalkSlot(slots, '2026-07-02', 't-soir')).toBeUndefined()
  })
})

describe('daySlotViews', () => {
  const date = '2026-07-01'
  const matin = makeTemplate({ id: 't-matin', name: 'Matin', startTime: '07:00', endTime: '09:00', sortOrder: 0 })
  const midi = makeTemplate({ id: 't-midi', name: 'Après-midi', startTime: '14:00', endTime: '17:00', sortOrder: 1 })
  const soir = makeTemplate({ id: 't-soir', name: 'Soir', startTime: '19:00', endTime: '21:00', sortOrder: 2 })

  it('dérive upcoming / current / missed selon le moment présent', () => {
    const now = atTime(date, '15:00')
    const views = daySlotViews([matin, midi, soir], [], date, now)
    expect(views.map((v) => v.status)).toEqual(['missed', 'current', 'upcoming'])
  })

  it('borne le statut current : début inclus, fin incluse, après = missed', () => {
    const only = [midi]
    expect(daySlotViews(only, [], date, atTime(date, '13:59'))[0].status).toBe('upcoming')
    expect(daySlotViews(only, [], date, atTime(date, '14:00'))[0].status).toBe('current')
    expect(daySlotViews(only, [], date, atTime(date, '17:00'))[0].status).toBe('current')
    expect(daySlotViews(only, [], date, atTime(date, '17:01'))[0].status).toBe('missed')
  })

  it('reprend done et skipped des lignes existantes, même dans le passé', () => {
    const now = atTime(date, '23:00')
    const slots = [
      makeSlot({ date, slotTemplateId: 't-matin', status: 'done' }),
      makeSlot({ date, slotTemplateId: 't-soir', status: 'skipped' }),
    ]
    const views = daySlotViews([matin, midi, soir], slots, date, now)
    expect(views.map((v) => v.status)).toEqual(['done', 'missed', 'skipped'])
    expect(views[0].slot).toBe(slots[0])
    expect(views[1].slot).toBeUndefined()
  })

  it('exclut les templates inactifs et trie par sortOrder', () => {
    const inactif = makeTemplate({ id: 't-nuit', name: 'Nuit', active: false, sortOrder: -1 })
    const views = daySlotViews([soir, inactif, matin, midi], [], date, atTime(date, '06:00'))
    expect(views.map((v) => v.template.id)).toEqual(['t-matin', 't-midi', 't-soir'])
  })
})

describe('activeTemplates', () => {
  it('filtre les inactifs et trie par sortOrder puis heure de début', () => {
    const a = makeTemplate({ id: 'a', sortOrder: 1, startTime: '19:00' })
    const b = makeTemplate({ id: 'b', sortOrder: 0, startTime: '14:00' })
    const c = makeTemplate({ id: 'c', sortOrder: 0, startTime: '07:00' })
    const off = makeTemplate({ id: 'off', sortOrder: 0, active: false })
    expect(activeTemplates([a, b, off, c]).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('ne modifie pas le tableau d’origine', () => {
    const templates = [makeTemplate({ sortOrder: 2 }), makeTemplate({ sortOrder: 1 })]
    const before = [...templates]
    activeTemplates(templates)
    expect(templates).toEqual(before)
  })
})

describe('validSlotTimes', () => {
  it('accepte début < fin, refuse égalité et inversion', () => {
    expect(validSlotTimes('07:00', '09:00')).toBe(true)
    expect(validSlotTimes('09:00', '09:00')).toBe(false)
    expect(validSlotTimes('19:00', '07:00')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Planning hebdomadaire
// ---------------------------------------------------------------------------

const MONDAY = '2026-06-29'
const NEXT_NEXT_MONDAY = '2026-07-13'

describe('weekAssignments', () => {
  it('ne garde que les lignes assignées de la semaine demandée', () => {
    const slots = [
      makeSlot({ date: '2026-06-29', slotTemplateId: 't-matin', assignedMemberId: 'lea' }),
      makeSlot({ date: '2026-07-05', slotTemplateId: 't-soir', assignedMemberId: 'bastien' }),
      makeSlot({ date: '2026-07-01', slotTemplateId: 't-midi' }), // non assignée
      makeSlot({ date: '2026-07-06', slotTemplateId: 't-matin', assignedMemberId: 'lea' }), // semaine suivante
    ]
    expect(weekAssignments(slots, MONDAY)).toEqual([
      { date: '2026-06-29', slotTemplateId: 't-matin', memberId: 'lea' },
      { date: '2026-07-05', slotTemplateId: 't-soir', memberId: 'bastien' },
    ])
  })
})

describe('duplicateWeekAssignments', () => {
  it('reporte chaque affectation sur le même jour de semaine', () => {
    const slots = [
      makeSlot({ date: '2026-07-01', slotTemplateId: 't-matin', assignedMemberId: 'lea' }), // mercredi
      makeSlot({ date: '2026-07-05', slotTemplateId: 't-soir', assignedMemberId: 'bastien' }), // dimanche
    ]
    expect(duplicateWeekAssignments(slots, MONDAY, NEXT_NEXT_MONDAY)).toEqual([
      { date: '2026-07-15', slotTemplateId: 't-matin', memberId: 'lea' },
      { date: '2026-07-19', slotTemplateId: 't-soir', memberId: 'bastien' },
    ])
  })
})

describe('semaine type', () => {
  it('weekTemplateFromWeek indexe par jour de semaine (lundi = 0) et créneau', () => {
    const slots = [
      makeSlot({ date: '2026-06-29', slotTemplateId: 't-matin', assignedMemberId: 'lea' }), // lundi
      makeSlot({ date: '2026-07-05', slotTemplateId: 't-soir', assignedMemberId: 'bastien' }), // dimanche
    ]
    expect(weekTemplateFromWeek(slots, MONDAY, 'h1')).toEqual({
      householdId: 'h1',
      assignments: { '0-t-matin': 'lea', '6-t-soir': 'bastien' },
    })
  })

  it('applyWeekTemplate produit les affectations concrètes d’une autre semaine', () => {
    const template = { householdId: 'h1', assignments: { '2-t-matin': 'lea', '6-t-soir': 'bastien' } }
    expect(applyWeekTemplate(template, NEXT_NEXT_MONDAY)).toEqual([
      { date: '2026-07-15', slotTemplateId: 't-matin', memberId: 'lea' }, // mercredi
      { date: '2026-07-19', slotTemplateId: 't-soir', memberId: 'bastien' }, // dimanche
    ])
  })

  it('capture puis application font un aller-retour fidèle (ids avec tirets compris)', () => {
    const slots = [
      makeSlot({ date: '2026-07-01', slotTemplateId: 'tpl-apres-midi', assignedMemberId: 'lea' }),
      makeSlot({ date: '2026-07-04', slotTemplateId: 't-soir', assignedMemberId: 'marc' }),
    ]
    const template = weekTemplateFromWeek(slots, MONDAY, 'h1')
    const replayed = applyWeekTemplate(template, MONDAY)
    expect(replayed).toEqual(
      expect.arrayContaining([
        { date: '2026-07-01', slotTemplateId: 'tpl-apres-midi', memberId: 'lea' },
        { date: '2026-07-04', slotTemplateId: 't-soir', memberId: 'marc' },
      ]),
    )
    expect(replayed).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Périodes de garde
// ---------------------------------------------------------------------------

describe('activeCarePeriod / nextCarePeriod', () => {
  const garde = makePeriod({ startAt: '2026-07-01T18:00:00.000Z', endAt: '2026-07-03T09:00:00.000Z' })

  it('trouve la garde en cours, début inclus', () => {
    expect(activeCarePeriod([garde], new Date('2026-07-02T12:00:00.000Z'))).toBe(garde)
    expect(activeCarePeriod([garde], new Date('2026-07-01T18:00:00.000Z'))).toBe(garde)
  })

  it('la fin est exclusive, et rien avant le début', () => {
    expect(activeCarePeriod([garde], new Date('2026-07-03T09:00:00.000Z'))).toBeUndefined()
    expect(activeCarePeriod([garde], new Date('2026-07-01T17:59:59.000Z'))).toBeUndefined()
  })

  it('nextCarePeriod renvoie la prochaine garde strictement future, la plus proche d’abord', () => {
    const loin = makePeriod({ startAt: '2026-07-10T08:00:00.000Z', endAt: '2026-07-12T08:00:00.000Z' })
    const proche = makePeriod({ startAt: '2026-07-05T08:00:00.000Z', endAt: '2026-07-06T08:00:00.000Z' })
    const at = new Date('2026-07-02T12:00:00.000Z')
    expect(nextCarePeriod([garde, loin, proche], at)).toBe(proche)
    expect(nextCarePeriod([garde], new Date('2026-07-04T00:00:00.000Z'))).toBeUndefined()
  })
})

describe('carePeriodConflicts', () => {
  const existante = makePeriod({
    id: 'cp-a',
    startAt: '2026-07-01T18:00:00.000Z',
    endAt: '2026-07-03T09:00:00.000Z',
  })

  it('détecte un chevauchement partiel', () => {
    expect(carePeriodConflicts([existante], '2026-07-02T00:00:00.000Z', '2026-07-04T00:00:00.000Z')).toEqual([
      existante,
    ])
  })

  it('deux périodes qui se touchent bout à bout ne sont pas en conflit', () => {
    expect(
      carePeriodConflicts([existante], '2026-07-03T09:00:00.000Z', '2026-07-05T09:00:00.000Z'),
    ).toEqual([])
    expect(
      carePeriodConflicts([existante], '2026-06-30T09:00:00.000Z', '2026-07-01T18:00:00.000Z'),
    ).toEqual([])
  })

  it('excludeId ignore la période en cours d’édition', () => {
    expect(
      carePeriodConflicts([existante], '2026-07-01T18:00:00.000Z', '2026-07-03T09:00:00.000Z', 'cp-a'),
    ).toEqual([])
  })
})

describe('carePeriodsOfWeek', () => {
  it('retient les gardes touchant la semaine, triées par début', () => {
    const avant = makePeriod({ startAt: '2026-06-20T10:00:00.000Z', endAt: '2026-06-22T10:00:00.000Z' })
    const chevauche = makePeriod({ startAt: '2026-06-27T10:00:00.000Z', endAt: '2026-06-30T10:00:00.000Z' })
    const dedans = makePeriod({ startAt: '2026-07-02T10:00:00.000Z', endAt: '2026-07-04T10:00:00.000Z' })
    const apres = makePeriod({ startAt: '2026-07-08T10:00:00.000Z', endAt: '2026-07-10T10:00:00.000Z' })
    expect(carePeriodsOfWeek([dedans, apres, avant, chevauche], MONDAY)).toEqual([chevauche, dedans])
  })
})

// ---------------------------------------------------------------------------
// Cascade de remplacement
// ---------------------------------------------------------------------------

describe('membersByPriority', () => {
  it('trie par rang de priorité sans muter l’original', () => {
    const lea = makeMember({ id: 'lea', priorityRank: 1 })
    const bastien = makeMember({ id: 'bastien', priorityRank: 0 })
    const marc = makeMember({ id: 'marc', priorityRank: 2 })
    const members = [lea, marc, bastien]
    expect(membersByPriority(members).map((m) => m.id)).toEqual(['bastien', 'lea', 'marc'])
    expect(members.map((m) => m.id)).toEqual(['lea', 'marc', 'bastien'])
  })
})

describe('nextCascadeTarget', () => {
  const bastien = makeMember({ id: 'bastien', priorityRank: 0 })
  const lea = makeMember({ id: 'lea', priorityRank: 1 })
  const papi = makeMember({ id: 'papi', priorityRank: 2, role: 'guest' })
  const marc = makeMember({ id: 'marc', priorityRank: 3 })
  const members = [marc, papi, lea, bastien]

  it('vise le premier de la liste hors demandeur', () => {
    expect(nextCascadeTarget(members, 'bastien', [])).toBe('lea')
    expect(nextCascadeTarget(members, 'lea', [])).toBe('bastien')
  })

  it('saute les membres déjà sollicités et les invités', () => {
    const cascade = [{ memberId: 'lea', notifiedAt: '2026-07-01T08:00:00.000Z', response: 'declined' as const }]
    expect(nextCascadeTarget(members, 'bastien', cascade)).toBe('marc')
  })

  it('renvoie null quand la liste est épuisée', () => {
    const cascade = [
      { memberId: 'lea', notifiedAt: '2026-07-01T08:00:00.000Z', response: 'declined' as const },
      { memberId: 'marc', notifiedAt: '2026-07-01T08:30:00.000Z', response: 'declined' as const },
    ]
    expect(nextCascadeTarget(members, 'bastien', cascade)).toBeNull()
  })
})

describe('currentCascadeTarget / swapsTargeting / exhaustedSwaps', () => {
  it('cible le dernier maillon sans réponse d’une demande ouverte', () => {
    const swap = makeSwap({
      cascade: [
        { memberId: 'lea', notifiedAt: '2026-07-01T08:00:00.000Z', response: 'declined' },
        { memberId: 'marc', notifiedAt: '2026-07-01T08:30:00.000Z' },
      ],
    })
    expect(currentCascadeTarget(swap)).toBe('marc')
  })

  it('null si le dernier maillon a refusé, si la cascade est vide ou si la demande n’est plus ouverte', () => {
    expect(
      currentCascadeTarget(
        makeSwap({
          cascade: [{ memberId: 'lea', notifiedAt: '2026-07-01T08:00:00.000Z', response: 'declined' }],
        }),
      ),
    ).toBeNull()
    expect(currentCascadeTarget(makeSwap({ cascade: [] }))).toBeNull()
    expect(
      currentCascadeTarget(
        makeSwap({
          status: 'accepted',
          acceptedBy: 'marc',
          cascade: [{ memberId: 'marc', notifiedAt: '2026-07-01T08:00:00.000Z' }],
        }),
      ),
    ).toBeNull()
  })

  it('swapsTargeting filtre les demandes dont je suis la cible courante', () => {
    const pourMarc = makeSwap({ cascade: [{ memberId: 'marc', notifiedAt: '2026-07-01T08:00:00.000Z' }] })
    const pourLea = makeSwap({ cascade: [{ memberId: 'lea', notifiedAt: '2026-07-01T08:00:00.000Z' }] })
    const fermee = makeSwap({ status: 'cancelled', cascade: [{ memberId: 'marc', notifiedAt: '2026-07-01T08:00:00.000Z' }] })
    expect(swapsTargeting([pourMarc, pourLea, fermee], 'marc')).toEqual([pourMarc])
  })

  it('exhaustedSwaps ne garde que les demandes épuisées', () => {
    const epuisee = makeSwap({ status: 'exhausted' })
    expect(exhaustedSwaps([makeSwap(), epuisee, makeSwap({ status: 'accepted' })])).toEqual([epuisee])
  })
})

// ---------------------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------------------

describe('galleryItems', () => {
  it('fusionne promenades validées et photos de discussion, plus récentes d’abord', () => {
    const walks = [
      makeSlot({
        status: 'done',
        photo: 'idb:walk-1',
        validatedAt: '2026-07-01T08:30:00.000Z',
        validatedBy: 'lea',
        note: 'Grand tour du parc',
      }),
    ]
    const messages = [
      makeMessage({ photo: 'idb:chat-1', createdAt: '2026-07-02T10:00:00.000Z', text: 'Sieste au soleil' }),
    ]
    const items = galleryItems(walks, messages)
    expect(items.map((i) => i.photo)).toEqual(['idb:chat-1', 'idb:walk-1'])
    expect(items[1]).toEqual({
      photo: 'idb:walk-1',
      createdAt: '2026-07-01T08:30:00.000Z',
      source: 'walk',
      authorId: 'lea',
      caption: 'Grand tour du parc',
    })
    expect(items[0].caption).toBe('Sieste au soleil')
  })

  it('ignore les photos de promenade non validées et les messages sans photo', () => {
    const walks = [makeSlot({ photo: 'idb:brouillon' })] // pas de validatedAt
    const messages = [makeMessage({ text: 'Sans photo' })]
    expect(galleryItems(walks, messages)).toEqual([])
  })

  it('déduplique une même photo en préférant la source promenade', () => {
    const walks = [
      makeSlot({
        status: 'done',
        photo: 'idb:double',
        validatedAt: '2026-07-01T08:30:00.000Z',
        validatedBy: 'lea',
      }),
    ]
    const messages = [
      makeMessage({
        kind: 'system',
        authorId: undefined,
        photo: 'idb:double',
        text: 'Léa a validé la promenade du matin',
        createdAt: '2026-07-01T08:30:05.000Z',
      }),
    ]
    const items = galleryItems(walks, messages)
    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('walk')
  })

  it('les messages système avec photo n’ont pas de légende, les textes vides non plus', () => {
    const messages = [
      makeMessage({ kind: 'system', authorId: undefined, photo: 'idb:sys', text: 'Validation' }),
      makeMessage({ photo: 'idb:muet', text: '', createdAt: '2026-07-02T09:00:00.000Z' }),
    ]
    const items = galleryItems([], messages)
    expect(items.every((i) => i.caption === undefined)).toBe(true)
  })
})
