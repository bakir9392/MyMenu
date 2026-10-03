const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');
const { dishImageUpload, uploadedPath, deleteStoredImage } = require('../imageStore');
const { getSettings, CURRENCIES } = require('../settings');
const { requireStaff } = require('../auth');
const { tenant, applyCurrency } = require('../access');

// Plats du menu + notes des clients. Chaque restaurant a son menu : le personnel voit et modifie le sien,
// le client voit celui du restaurant de sa table.

const parseImages = (value) => {
  try {
    const images = JSON.parse(value || '[]');
    return Array.isArray(images) ? images : [];
  } catch {
    return [];
  }
};

const serializeDish = (row, currency) => row && ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: Number(row.price),
  currency,
  category: row.category,
  images: parseImages(row.images),
  is_available: Boolean(row.is_available),
  average_rating: Number(row.average_rating),
  total_ratings: Number(row.total_ratings),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

/** Supprime les fichiers de photos qu'aucun autre plat (d'aucun restaurant) n'utilise encore */
async function releaseImages(paths, exceptDishId) {
  for (const image of paths) {
    const stillUsed = await get('SELECT id FROM dishes WHERE id != ? AND images LIKE ? LIMIT 1', [exceptDishId, `%${image}%`]);
    if (!stillUsed) deleteStoredImage(image);
  }
}

const toBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'on', true, 1].includes(value);
};

const validationError = (res, errors) => res.status(422).json({ message: 'Validation failed', errors });

const getDish = async (restaurantId, id) => {
  const row = await get('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?', [id, restaurantId]);
  return row ? serializeDish(row, (await getSettings(restaurantId)).currency) : null;
};

router.get('/test', (req, res) => res.json({ message: 'API works!' }));

router.get('/dishes', tenant, async (req, res, next) => {
  try {
    const { currency } = await getSettings(req.rid);
    const rows = await all('SELECT * FROM dishes WHERE restaurant_id = ? ORDER BY created_at DESC, id DESC', [req.rid]);
    res.json(rows.map((row) => serializeDish(row, currency)));
  } catch (error) {
    next(error);
  }
});

router.get('/dishes/:id', tenant, async (req, res, next) => {
  try {
    const dish = await getDish(req.rid, req.params.id);
    if (!dish) return res.status(404).json({ message: 'Dish not found' });
    res.json(dish);
  } catch (error) {
    next(error);
  }
});

// multipart/form-data : name, description, price, category, currency (EUR | USD), is_available, images[] (fichiers)
router.post('/dishes', requireStaff, tenant, dishImageUpload.array('images[]'), async (req, res, next) => {
  try {
    const { name, description, price, category } = req.body;
    const errors = {};
    if (!name || !String(name).trim()) errors.name = ['The name field is required.'];
    if (price === undefined || price === '' || isNaN(Number(price)) || Number(price) < 0) errors.price = ['The price must be a positive number.'];
    const requested = String(req.body.currency || '').toUpperCase();
    if (requested && !CURRENCIES.includes(requested)) errors.currency = ['Unsupported currency (EUR, USD or DZD)'];
    if (Object.keys(errors).length) {
      (req.files || []).forEach((file) => deleteStoredImage(uploadedPath(file)));
      return validationError(res, errors);
    }
    await applyCurrency(req, requested);

    const images = (req.files || []).map(uploadedPath);
    const { lastID } = await run(
      `INSERT INTO dishes (restaurant_id, name, description, price, category, images, is_available) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.rid, String(name).trim(), description || null, Number(price), category || null, JSON.stringify(images), toBool(req.body.is_available) ? 1 : 0]
    );
    res.status(201).json(await getDish(req.rid, lastID));
  } catch (error) {
    next(error);
  }
});

router.put('/dishes/:id', requireStaff, tenant, dishImageUpload.array('images[]'), async (req, res, next) => {
  try {
    const current = await get('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    if (!current) {
      (req.files || []).forEach((file) => deleteStoredImage(uploadedPath(file)));
      return res.status(404).json({ message: 'Dish not found' });
    }

    const body = req.body || {};
    const requested = String(body.currency || '').toUpperCase();
    if (requested && !CURRENCIES.includes(requested)) return validationError(res, { currency: ['Unsupported currency (EUR, USD or DZD)'] });

    const fields = [];
    const values = [];
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return validationError(res, { name: ['The name field is required.'] });
      fields.push('name = ?'); values.push(String(body.name).trim());
    }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description || null); }
    if (body.price !== undefined) {
      if (isNaN(Number(body.price)) || Number(body.price) < 0) return validationError(res, { price: ['The price must be a positive number.'] });
      fields.push('price = ?'); values.push(Number(body.price));
    }
    if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category || null); }
    if (body.is_available !== undefined) { fields.push('is_available = ?'); values.push(toBool(body.is_available) ? 1 : 0); }

    // Nouvelles photos : elles remplacent les anciennes (fichiers supprimés)
    if (req.files && req.files.length > 0) {
      await releaseImages(parseImages(current.images), current.id);
      fields.push('images = ?'); values.push(JSON.stringify(req.files.map(uploadedPath)));
    }

    if (fields.length > 0) {
      await run(`UPDATE dishes SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND restaurant_id = ?`,
        [...values, req.params.id, req.rid]);
    }
    await applyCurrency(req, requested);
    res.json(await getDish(req.rid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.delete('/dishes/:id', requireStaff, tenant, async (req, res, next) => {
  try {
    const current = await get('SELECT id, images FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    if (!current) return res.status(404).json({ message: 'Dish not found' });
    await run('DELETE FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    await releaseImages(parseImages(current.images), current.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Supprime une photo d'un plat (fichier + référence), seulement si elle appartient à ce restaurant
router.delete('/delete-image', requireStaff, tenant, async (req, res, next) => {
  try {
    const imageUrl = req.body && req.body.image_url;
    if (!imageUrl) return validationError(res, { image_url: ['The image url field is required.'] });
    const path = imageUrl.slice(Math.max(0, imageUrl.indexOf('/images/')));
    const rows = await all('SELECT id, images FROM dishes WHERE restaurant_id = ? AND images LIKE ?', [req.rid, `%${path}%`]);
    for (const row of rows) {
      const images = parseImages(row.images).filter((image) => image !== path);
      await run('UPDATE dishes SET images = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(images), row.id]);
    }
    if (rows.length > 0) deleteStoredImage(path);
    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ---- Notes des plats ----

async function refreshDishRating(dishId) {
  await run(
    `UPDATE dishes SET
       average_rating = COALESCE((SELECT ROUND(AVG(rating), 2) FROM ratings WHERE dish_id = ?), 0),
       total_ratings = (SELECT COUNT(*) FROM ratings WHERE dish_id = ?)
     WHERE id = ?`,
    [dishId, dishId, dishId]
  );
}

router.post('/ratings', tenant, async (req, res, next) => {
  try {
    const { dish_id: dishId, rating, comment } = req.body || {};
    const value = parseInt(rating, 10);
    const errors = {};
    if (!dishId || !(await get('SELECT id FROM dishes WHERE id = ? AND restaurant_id = ?', [dishId, req.rid]))) {
      errors.dish_id = ['The selected dish id is invalid.'];
    }
    if (!(value >= 1 && value <= 5)) errors.rating = ['The rating must be between 1 and 5.'];
    if (comment && String(comment).length > 500) errors.comment = ['The comment may not be greater than 500 characters.'];
    if (Object.keys(errors).length) return res.status(422).json({ error: 'Validation failed', details: errors });

    // Un avis par plat et par client : la session de table identifie le client (à défaut, son adresse)
    const userIdentifier = req.customer ? `session:${req.customer.token.slice(0, 20)}` : req.ip;
    const existing = await get('SELECT id FROM ratings WHERE dish_id = ? AND user_identifier = ?', [dishId, userIdentifier]);
    if (existing) {
      return res.status(409).json({ error: 'You have already rated this dish', message: 'Each user can only rate a dish once' });
    }

    const { lastID } = await run(
      'INSERT INTO ratings (dish_id, rating, user_identifier, comment) VALUES (?, ?, ?, ?)',
      [dishId, value, userIdentifier, comment || null]
    );
    await refreshDishRating(dishId);
    res.status(201).json({
      message: 'Rating added successfully',
      rating: await get('SELECT id, dish_id, rating, comment, created_at FROM ratings WHERE id = ?', [lastID]),
      dish: await getDish(req.rid, dishId),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dishes/:id/ratings', tenant, async (req, res, next) => {
  try {
    const dish = await getDish(req.rid, req.params.id);
    if (!dish) return res.status(404).json({ message: 'Dish not found' });
    const ratings = await all(
      'SELECT rating, comment, created_at FROM ratings WHERE dish_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({
      dish: { id: dish.id, name: dish.name, average_rating: dish.average_rating, total_ratings: dish.total_ratings },
      ratings,
    });
  } catch (error) {
    next(error);
  }
});

// Liste paginée (20 par page), même forme que la pagination Laravel
router.get('/ratings', requireStaff, tenant, async (req, res, next) => {
  try {
    const perPage = 20;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { total } = await get(
      'SELECT COUNT(*) AS total FROM ratings r JOIN dishes d ON d.id = r.dish_id WHERE d.restaurant_id = ?',
      [req.rid]
    );
    const rows = await all(
      `SELECT r.id, r.dish_id, r.rating, r.comment, r.created_at, d.name AS dish_name
       FROM ratings r JOIN dishes d ON d.id = r.dish_id WHERE d.restaurant_id = ?
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [req.rid, perPage, (page - 1) * perPage]
    );
    res.json({
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
      data: rows.map(({ dish_name, ...rating }) => ({ ...rating, dish: { id: rating.dish_id, name: dish_name } })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { router, serializeDish, parseImages, releaseImages };
