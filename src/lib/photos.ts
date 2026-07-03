import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useEffect, useState } from 'react'
import type { PhotoRef } from '../domain/types'
import { newId } from './ids'

/**
 * Redimensionne et compresse une image avant stockage/upload.
 * Retourne un Blob JPEG ≤ maxDim px de côté.
 */
export async function compressImage(file: Blob, maxDim = 1280, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  return blob ?? file
}

/** Stocke un blob photo en local (IndexedDB) et retourne sa référence `idb:…`. */
export async function storeLocalPhoto(blob: Blob): Promise<PhotoRef> {
  const ref = `idb:${newId()}`
  await idbSet(ref, blob)
  return ref
}

const objectUrlCache = new Map<string, string>()

/** Résout une PhotoRef en URL affichable (http(s), data:, ou blob local). */
export async function resolvePhotoUrl(ref: PhotoRef): Promise<string | null> {
  if (ref.startsWith('http') || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('/')) {
    return ref
  }
  if (ref.startsWith('idb:')) {
    const cached = objectUrlCache.get(ref)
    if (cached) return cached
    const blob = await idbGet<Blob>(ref)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    objectUrlCache.set(ref, url)
    return url
  }
  return null
}

/** Hook React : URL affichable pour une PhotoRef (ou null pendant le chargement). */
export function usePhotoUrl(ref: PhotoRef | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    ref && !ref.startsWith('idb:') ? ref : null,
  )
  useEffect(() => {
    let alive = true
    if (!ref) {
      setUrl(null)
      return
    }
    void resolvePhotoUrl(ref).then((u) => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [ref])
  return url
}
