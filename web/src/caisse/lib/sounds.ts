// Sons de notification générés par le navigateur (Web Audio) : aucun fichier audio à charger.
// Fichier identique dans les trois interfaces (client, caisse, admin).

export type SoundKind = "order" | "confirmed" | "served" | "paid" | "cancelled" | "message";

// Notes (fréquence en Hz, durée en s) de chaque son
const MELODIES: Record<SoundKind, [number, number][]> = {
  order: [[880, 0.12], [1175, 0.12], [1568, 0.22]], // nouvelle commande (personnel)
  confirmed: [[660, 0.12], [880, 0.2]],
  served: [[784, 0.12], [988, 0.12], [1319, 0.25]],
  paid: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]],
  cancelled: [[440, 0.18], [330, 0.3]],
  message: [[988, 0.1], [1319, 0.1], [988, 0.1], [1319, 0.2]],
};

let context: AudioContext | null = null;

const getContext = () => {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  context ??= new AudioCtx();
  return context;
};

// Les navigateurs (surtout sur téléphone) n'autorisent le son qu'après une première interaction de l'utilisateur
if (typeof window !== "undefined") {
  const unlock = () => {
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  ["pointerdown", "keydown", "touchstart"].forEach((event) => window.addEventListener(event, unlock, { passive: true }));
}

export function playSound(kind: SoundKind) {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    let time = ctx.currentTime + 0.02;
    for (const [frequency, duration] of MELODIES[kind]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.3, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.02);
      time += duration * 0.9;
    }
    // Vibration sur téléphone pour les messages et l'annulation
    if ((kind === "message" || kind === "cancelled") && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
  } catch {
    // son indisponible : la notification visuelle suffit
  }
}
