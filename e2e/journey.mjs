/**
 * Parcours de bout en bout complet (mode démo), sur le build de production.
 * Prérequis : `npm run build` puis `npx vite preview --port 4173`.
 * Usage : node e2e/journey.mjs   (OUT_DIR pour les captures d'écran)
 */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const OUT = process.env.OUT_DIR ?? '.'

const failures = []
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`)
  if (!cond) failures.push(label)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  acceptDownloads: true,
})
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))

const settle = (ms = 400) => page.waitForTimeout(ms)
const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage })

// --- 1. Accueil + chargement de la démo -------------------------------------
await page.goto(BASE, { waitUntil: 'networkidle' })
check(await page.getByText('Dogagenda').first().isVisible(), 'Accueil visible')
await shot('01-bienvenue', false)
await page.getByText('Découvrir avec la famille de Wint').click()
await page.waitForURL('**/aujourdhui')
await settle()

// --- 2. Aujourd'hui : garde + bannière de cascade ----------------------------
check(await page.getByText('Bastien garde Wint').isVisible(), 'Garde en cours affichée')
check(
  await page.getByText(/Marco cherche un remplaçant/).isVisible(),
  'Demande de remplacement entrante (cible Bastien)',
)
await shot('02-aujourdhui')

// --- 3. Accepter la demande de Marco -----------------------------------------
await page.getByRole('button', { name: /J’accepte/ }).click()
await settle()
check(
  !(await page.getByText(/Marco cherche un remplaçant/).isVisible().catch(() => false)),
  'Bannière disparue après acceptation',
)

// --- 4. Valider une promenade avec note --------------------------------------
await page.getByRole('button', { name: /C’est promené|Valider en avance/ }).first().click()
await settle()
check(await page.getByText('Un mot sur la promenade ?').isVisible(), 'Sheet note post-validation')
await page.locator('textarea').fill('Test E2E : grande balade au parc !')
await page.getByRole('button', { name: 'Enregistrer' }).click()
await settle()
check(await page.getByText(/Validée par Bastien/).first().isVisible(), 'Promenade validée par Bastien')
await shot('03-validation')

// --- 5. « Je ne peux pas » : créer une demande (cascade) ----------------------
// On s'assigne le dernier créneau encore en attente, puis on demande un remplaçant.
await page.getByLabel('Changer le promeneur').last().click()
await settle()
await page.getByRole('button', { name: 'Bastien', exact: true }).click()
await settle()
await page.getByRole('button', { name: 'Je ne peux pas' }).last().click()
await settle()
check(
  await page.getByText(/Léa sera prévenu/).isVisible(),
  'La cascade annonce Léa comme première notifiée',
)
await page.locator('textarea').fill('Empêchement E2E')
await page.getByRole('button', { name: 'Envoyer la demande' }).click()
await settle()
check(await page.getByText(/en attente de Léa/).isVisible(), 'Demande en attente de Léa')

// --- 6. Discussion : messages système + envoi texte et photo ------------------
await page.getByRole('link', { name: 'Discussion' }).click()
await settle()
check(await page.getByText(/a validé la promenade/).first().isVisible(), 'Message système : validation')
check(await page.getByText(/Bastien remplace Marco/).isVisible(), 'Message système : remplacement accepté')
check(await page.getByText(/Bastien cherche un remplaçant/).isVisible(), 'Message système : demande créée')
await page.getByLabel('Message').fill('Coucou la famille ! Test E2E 🐾')
await page.keyboard.press('Enter')
await settle()
check(await page.getByText('Coucou la famille ! Test E2E 🐾').isVisible(), 'Message envoyé visible')
await page.locator('input[type=file]').setInputFiles('public/icons/pwa-512.png')
await settle(900)
await page.getByLabel('Envoyer').click()
await settle(900)
const chatImgs = await page.locator('img').count()
check(chatImgs >= 1, 'Photo envoyée dans la discussion')
await shot('04-discussion')

// --- 7. Planning : gardes, duplication, assignation par lot -------------------
await page.getByRole('link', { name: 'Planning' }).click()
await settle()
check(await page.getByText(/Semaine du/).isVisible(), 'En-tête de semaine')
check((await page.getByText(/garde Wint/).count()) >= 1, 'Gardes de la semaine listées')
await page.getByLabel('Semaine suivante').click()
await settle()
await page.getByRole('button', { name: /Dupliquer la semaine précédente/ }).click()
await settle()
check(await page.getByText(/créneaux copiés|créneau copié/).isVisible(), 'Duplication confirmée (toast)')
// Assignation par lot : premier chip → « Toute la semaine » → Mamie Jo
await page.locator('button:has-text("☀️")').first().click()
await settle()
check(await page.getByText(/Qui promène Wint/).isVisible(), 'MemberPicker du planning ouvert')
await page.getByRole('button', { name: 'Toute la semaine' }).click()
await page.getByRole('button', { name: 'Mamie Jo', exact: true }).click()
await settle()
check(await page.getByText('Créneaux assignés').isVisible(), 'Assignation par lot confirmée')
// Périmètre « Toute la journée » : tous les créneaux d'un même jour → Léa
await page.locator('button:has-text("🌙")').first().click()
await settle()
await page.getByRole('button', { name: 'Toute la journée' }).click()
await page.getByRole('button', { name: 'Léa', exact: true }).click()
await settle()
check(await page.getByText('Journée assignée').isVisible(), 'Assignation « Toute la journée » confirmée')
await shot('05-planning')
await page.getByRole('button', { name: 'Revenir à aujourd’hui' }).click()
await settle()

// --- 8. Fiche Wint : invitation, galerie, calendrier --------------------------
await page.getByRole('link', { name: 'Wint' }).click()
await settle()
check(await page.getByText('WINT24').isVisible(), 'Code d’invitation affiché')
// Réordonner la cascade par glisser-déposer : Léa descend d'un rang
const grip = page.getByLabel(/Réordonner Léa/)
await grip.scrollIntoViewIfNeeded()
const gripBox = await grip.boundingBox()
await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
await page.mouse.down()
await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 + 62, { steps: 8 })
await page.mouse.up()
await settle()
check(await page.getByText('Ordre mis à jour').isVisible(), 'Réordonnancement par glisser-déposer')
check((await page.getByLabel('Voir la photo en grand').count()) >= 1, 'Galerie : photo présente')
const downloadPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Télécharger mon calendrier/ }).click()
const download = await downloadPromise
const icsPath = `${OUT}/mon-calendrier.ics`
await download.saveAs(icsPath)
const ics = readFileSync(icsPath, 'utf8')
check(ics.includes('BEGIN:VCALENDAR') && ics.includes('BEGIN:VEVENT'), 'Fichier .ics valide')
check(/Garde de Wint|Promenade/.test(ics), 'Événements Dogagenda dans le .ics')
await shot('06-fiche-wint')

// --- 9. Cascade complète : Léa refuse, Marco accepte --------------------------
await page.getByRole('button', { name: 'Changer de membre (démo)' }).click()
await settle()
await page.getByRole('button', { name: 'Léa', exact: true }).click()
await settle()
await page.getByRole('link', { name: /Aujourd/ }).click()
await settle()
const banner = page.locator('div.bg-peach-50')
check(
  await banner.getByText(/Bastien cherche un remplaçant/).isVisible(),
  'Léa voit la demande de Bastien',
)
await banner.getByRole('button', { name: 'Je ne peux pas' }).click()
await settle()
check(
  !(await banner.getByText(/Bastien cherche un remplaçant/).isVisible().catch(() => false)),
  'Après refus de Léa, la bannière passe au suivant',
)
await page.getByRole('link', { name: 'Wint' }).click()
await settle()
await page.getByRole('button', { name: 'Changer de membre (démo)' }).click()
await settle()
await page.getByRole('button', { name: 'Marco', exact: true }).click()
await settle()
await page.getByRole('link', { name: /Aujourd/ }).click()
await settle()
check(
  await page.locator('div.bg-peach-50').getByText(/Bastien cherche un remplaçant/).isVisible(),
  'La cascade a bien notifié Marco (2e de la liste)',
)
await page.getByRole('button', { name: /J’accepte/ }).click()
await settle()
await page.getByRole('link', { name: 'Discussion' }).click()
await settle()
check(await page.getByText(/Marco remplace Bastien/).isVisible(), 'Message système : Marco remplace Bastien')

// --- 10. Mode sombre -----------------------------------------------------------
await page.emulateMedia({ colorScheme: 'dark' })
await page.getByRole('link', { name: /Aujourd/ }).click()
await settle()
await shot('07-mode-sombre')
await page.emulateMedia({ colorScheme: 'light' })

// --- 11. PWA : manifest + service worker ---------------------------------------
const manifest = await page.request.get(`${BASE}/manifest.webmanifest`)
check(manifest.ok(), 'manifest.webmanifest accessible')
check((await manifest.text()).includes('Dogagenda'), 'Manifest nomme Dogagenda')
const sw = await page.request.get(`${BASE}/sw.js`)
check(sw.ok(), 'Service worker accessible')

// --- Bilan ----------------------------------------------------------------------
console.log('\nCONSOLE ERRORS:', consoleErrors.length ? consoleErrors : 'aucune')
if (consoleErrors.length) failures.push(`Erreurs console : ${consoleErrors.join(' | ')}`)
await browser.close()
if (failures.length) {
  console.error(`\n✗ ${failures.length} échec(s) :\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\n✓ Parcours complet réussi')
