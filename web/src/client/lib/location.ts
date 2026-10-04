export interface OrderPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

export type PositionError = "denied" | "unavailable";

/** Position actuelle de l'appareil (la restriction de distance des commandes est contrôlée par le serveur) */
export function getCurrentPosition(): Promise<{ position: OrderPosition } | { error: PositionError }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({ error: "unavailable" });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (result) =>
        resolve({ position: { lat: result.coords.latitude, lng: result.coords.longitude, accuracy: result.coords.accuracy } }),
      (failure) => resolve({ error: failure.code === failure.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });
}
