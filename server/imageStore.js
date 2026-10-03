const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Images servies par le serveur sous /images/... (fichiers sur disque, seul le chemin est stocké en base)
const IMAGES_ROOT = path.join(__dirname, 'public', 'images');
const DISHES_DIR = path.join(IMAGES_ROOT, 'dishes');
const DISHES_PREFIX = '/images/dishes/';

const EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

const uniqueName = (extension) => `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`;

/** Upload multipart des photos de plats (déjà réduites par le navigateur avant l'envoi) */
const dishImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(DISHES_DIR, { recursive: true });
      cb(null, DISHES_DIR);
    },
    filename: (req, file, cb) => cb(null, uniqueName(EXTENSIONS[file.mimetype] || '.jpg')),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXTENSIONS[file.mimetype])),
});

const uploadedPath = (file) => DISHES_PREFIX + file.filename;

/**
 * Normalise une image reçue en JSON avant de l'enregistrer :
 * - base64 (data:image/...) -> écrite dans un fichier, on ne garde que son chemin
 * - URL absolue d'une image hébergée ici -> chemin relatif (/images/...)
 * - autre valeur -> inchangée
 */
function normalizeImageUrl(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (match) {
    const extension = EXTENSIONS[match[1].toLowerCase()];
    if (!extension) return null;
    fs.mkdirSync(DISHES_DIR, { recursive: true });
    const filename = uniqueName(extension);
    fs.writeFileSync(path.join(DISHES_DIR, filename), Buffer.from(match[2], 'base64'));
    return DISHES_PREFIX + filename;
  }

  const index = value.indexOf('/images/');
  if (/^https?:\/\//.test(value) && index !== -1) {
    return value.slice(index);
  }

  return value;
}

/** Supprime le fichier d'une image hébergée ici (après remplacement ou suppression du plat). */
function deleteStoredImage(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('/images/')) return;
  const filePath = path.normalize(path.join(IMAGES_ROOT, value.slice('/images/'.length)));
  if (!filePath.startsWith(IMAGES_ROOT + path.sep)) return; // pas de sortie du dossier images
  fs.promises.unlink(filePath).catch(() => {});
}

module.exports = { IMAGES_ROOT, dishImageUpload, uploadedPath, normalizeImageUrl, deleteStoredImage };
