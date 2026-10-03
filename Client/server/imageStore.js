const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, 'public', 'images', 'menu-items');
const PUBLIC_PREFIX = '/images/menu-items/';

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/**
 * Normalise la valeur reçue pour image_url avant de l'enregistrer en base :
 * - image en base64 (data:image/...) -> écrite dans un fichier, on ne garde que son chemin
 * - URL absolue d'une image déjà hébergée ici (renvoyée telle quelle par le front lors d'une modification) -> chemin relatif
 * - autre URL -> inchangée
 */
function normalizeImageUrl(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (match) {
    const extension = EXTENSIONS[match[1].toLowerCase()] || '.jpg';
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(match[2], 'base64'));
    return PUBLIC_PREFIX + filename;
  }

  const index = value.indexOf(PUBLIC_PREFIX);
  if (/^https?:\/\//.test(value) && index !== -1) {
    return value.slice(index);
  }

  return value;
}

/** Chemin stocké en base -> URL absolue utilisable par les fronts (qui tournent sur d'autres ports). */
function toPublicUrl(req, value) {
  if (value && value.startsWith(PUBLIC_PREFIX)) {
    return `${req.protocol}://${req.get('host')}${value}`;
  }
  return value;
}

/** Supprime le fichier d'une image hébergée ici (après remplacement ou suppression du plat). */
function deleteStoredImage(value) {
  if (!value || !value.startsWith(PUBLIC_PREFIX)) return;
  const filePath = path.join(IMAGES_DIR, path.basename(value));
  fs.promises.unlink(filePath).catch(() => {});
}

module.exports = { normalizeImageUrl, toPublicUrl, deleteStoredImage };
