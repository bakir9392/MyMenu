/**
 * Réduit une photo avant l'envoi au serveur (côté max `maxSize` px, JPEG ou WebP compressé),
 * pour que le menu se charge vite sur les téléphones des clients.
 * En cas d'échec (format non lisible par le navigateur), le fichier original est renvoyé.
 */
export async function compressImage(file: File, maxSize = 1200, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;

    // Fond blanc pour les images transparentes (PNG) avant compression JPEG
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const type = "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type, lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Même chose, mais renvoie une data URL (pour les écrans qui envoient l'image en base64). */
export async function compressImageToDataUrl(file: File, maxSize = 1200, quality = 0.82): Promise<string> {
  const compressed = await compressImage(file, maxSize, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(compressed);
  });
}
