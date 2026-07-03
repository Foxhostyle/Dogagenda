import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const OUT = process.env.OUT_DIR ?? '.'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/smoke-welcome.png` })

// Charge la démo
await page.getByText('Découvrir avec la famille de Wint').click()
await page.waitForURL('**/aujourdhui', { timeout: 5000 })
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/smoke-today.png`, fullPage: true })

// Valide une promenade (premier bouton « C'est promené » ou « Valider »)
const btn = page.getByRole('button', { name: /promené|Valider/ }).first()
await btn.click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/smoke-validated.png`, fullPage: true })

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
