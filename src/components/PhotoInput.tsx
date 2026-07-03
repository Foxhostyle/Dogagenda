import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { provider } from '../data'
import { compressImage, usePhotoUrl } from '../lib/photos'
import { useToasts } from '../store/useToasts'
import type { PhotoRef } from '../domain/types'
import { Button, cx } from './ui'

/**
 * Bouton « ajouter une photo » : ouvre l'appareil photo / la galerie,
 * compresse, stocke via le provider et remonte la référence.
 */
export default function PhotoInput({
  value,
  onChange,
  label = 'Ajouter une photo',
  className,
}: {
  value?: PhotoRef
  onChange: (ref: PhotoRef | undefined) => void
  label?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const url = usePhotoUrl(value)
  const error = useToasts((s) => s.error)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const blob = await compressImage(file)
      onChange(await provider.savePhoto(blob))
    } catch {
      error('Impossible d’enregistrer la photo.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={cx('flex items-center gap-3', className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {value && url ? (
        <div className="relative">
          <img src={url} alt="Photo ajoutée" className="size-20 rounded-2xl object-cover" />
          <button
            type="button"
            aria-label="Retirer la photo"
            onClick={() => onChange(undefined)}
            className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-bark-900 text-white shadow"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <Button
          variant="soft"
          loading={busy}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          <Camera className="size-5" aria-hidden />
          {label}
        </Button>
      )}
    </div>
  )
}
