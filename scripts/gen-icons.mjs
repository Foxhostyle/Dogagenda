/**
 * Génère les icônes PWA (patte blanche sur fond vert sauge) avec sharp.
 * Usage : node scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'

const BG = '#578764'

// contentScale < 1 réserve une marge (zone sûre des icônes maskable).
function iconSvg(size, { rounded = true, contentScale = 0.72 } = {}) {
  const r = rounded ? size * 0.22 : 0
  const s = (size / 240) * contentScale
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>
  <g transform="translate(${size / 2}, ${size / 2 + 14 * s}) scale(${s})" fill="#ffffff">
    <ellipse cx="0" cy="34" rx="52" ry="42"/>
    <circle cx="-58" cy="-16" r="24"/>
    <circle cx="-21" cy="-46" r="25"/>
    <circle cx="21" cy="-46" r="25"/>
    <circle cx="58" cy="-16" r="24"/>
  </g>
</svg>`
}

await mkdir('public/icons', { recursive: true })

const targets = [
  { file: 'pwa-192.png', size: 192, opts: {} },
  { file: 'pwa-512.png', size: 512, opts: {} },
  { file: 'pwa-maskable-512.png', size: 512, opts: { rounded: false, contentScale: 0.58 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { rounded: false } },
]

for (const { file, size, opts } of targets) {
  await sharp(Buffer.from(iconSvg(size, opts))).png().toFile(`public/icons/${file}`)
  console.log('✓', file)
}

await writeFile('public/icons/favicon.svg', iconSvg(64))
console.log('✓ favicon.svg')
