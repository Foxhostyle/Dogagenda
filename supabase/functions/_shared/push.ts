/**
 * Envoi de notifications Web Push depuis les Edge Functions.
 *
 * Les clés VAPID sont lues dans les secrets du projet :
 *   supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…
 */
import webpush from 'npm:web-push@3'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@dogagenda.app'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

/** Charge utile affichée par le service worker de l'application. */
export interface PushPayload {
  title: string
  body: string
  /** Regroupe les notifications de même nature sur l'appareil. */
  tag?: string
  /** Chemin ouvert au tap (ex. « /planning »). */
  url?: string
  /** Pour les demandes de remplacement : ajoute les boutons Accepter/Refuser. */
  swapId?: string
}

/**
 * Envoie une notification push à un abonnement.
 *
 * Retourne `false` en cas d'échec (clés absentes, abonnement expiré — 404/410 —
 * ou erreur réseau) : l'appelant peut alors nettoyer l'abonnement mort au lieu
 * de réessayer indéfiniment. Ne lève jamais d'exception.
 */
export async function sendPush(
  subscription: unknown,
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('sendPush : clés VAPID absentes, notification ignorée.')
    return false
  }
  if (!subscription || typeof subscription !== 'object') return false
  try {
    await webpush.sendNotification(
      subscription as { endpoint: string; keys: { p256dh: string; auth: string } },
      JSON.stringify(payload),
      { TTL: 60 * 60 }, // au-delà d'une heure, le rappel n'a plus de sens
    )
    return true
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    console.warn(`sendPush : échec (statut ${status ?? 'inconnu'})`, (err as Error).message)
    return false
  }
}
