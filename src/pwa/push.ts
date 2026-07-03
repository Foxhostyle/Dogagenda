/**
 * Abonnement Web Push de l'appareil (mode Supabase uniquement) :
 * permission → service worker → PushManager → enregistrement côté serveur.
 */
import { provider } from '../data'

/** Convertit une clé VAPID base64-url en tableau d'octets pour PushManager. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Active les notifications push sur cet appareil et enregistre l'abonnement. */
export async function subscribeToPush(vapidPublicKey: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Les notifications push ne sont pas disponibles sur cet appareil.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      'Les notifications ont été refusées. Tu peux les autoriser dans les réglages de ton navigateur.',
    )
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
  await provider.savePushSubscription(subscription.toJSON())
}

/** Désactive les push sur cet appareil et efface l'abonnement côté serveur. */
export async function unsubscribePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) await subscription.unsubscribe()
  await provider.savePushSubscription(null)
}
