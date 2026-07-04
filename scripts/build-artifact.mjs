/**
 * Empaquette le build « artifact » (VITE_ARTIFACT=1, dist-artifact/) en un
 * fichier HTML unique : CSS et JS inlinés, polices latines en data-URI.
 * Usage : VITE_ARTIFACT=1 npx vite build --outDir dist-artifact
 *         node scripts/build-artifact.mjs <sortie.html>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const outFile = process.argv[2] ?? 'dist-artifact/dogagenda-demo.html'
const dist = 'dist-artifact'
const html = readFileSync(`${dist}/index.html`, 'utf8')

const scriptSrc = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1]
const cssHrefs = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1])
if (!scriptSrc || cssHrefs.length === 0) {
  throw new Error('Script ou CSS introuvable dans dist-artifact/index.html')
}

let css = cssHrefs.map((href) => readFileSync(`${dist}${href}`, 'utf8')).join('\n')

// Polices : inline les sous-ensembles latins (suffisants pour le français) ;
// les autres @font-face ne seront jamais téléchargés (unicode-range).
css = css.replace(/url\((\/assets\/nunito-[^)]+\.woff2)\)/g, (full, path) => {
  if (!/latin/.test(path)) return full
  const b64 = readFileSync(`${dist}${path}`).toString('base64')
  return `url(data:font/woff2;base64,${b64})`
})

const js = readFileSync(`${dist}${scriptSrc}`, 'utf8').replace(/<\/script/g, '<\\/script')

const page = `<title>Dogagenda — démo</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`

writeFileSync(outFile, page)
console.log(`✓ ${resolve(outFile)} (${Math.round(page.length / 1024)} Ko)`)
