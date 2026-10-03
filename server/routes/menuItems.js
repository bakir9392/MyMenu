const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');
const { normalizeImageUrl } = require('../imageStore');
const { parseImages, releaseImages } = require('./dishes');
const { getSettings, CURRENCIES } = require('../settings');
const { requireStaff } = require('../auth');
const { tenant, applyCurrency } = require('../access');

// Format historique de l'écran "Gérer le menu" de la caisse, appliqué au menu du restaurant (table dishes) :
// la caisse, l'admin et le menu client d'un même restaurant voient et modifient les mêmes plats.

router.use(requireStaff, tenant);

const toMenuItem = (row, currency) => row && ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  price: Number(row.price),
  currency,
  category: row.category || '',
  image_url: parseImages(row.images)[0] || null,
  available: row.is_available ? 1 : 0,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const ok = (res, data, extra = {}) => res.json({ success: true, ...extra, data });
const fail = (res, error) => {
  console.error('Menu items error:', error);
  res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
};

function validate(body) {
  const { name, description, price, category, currency } = body || {};
  if (!name || !description || !price || !category) {
    return { status: 400, body: { success: false, error: 'Missing required fields', required: ['name', 'description', 'price', 'category'] } };
  }
  if (Number(price) <= 0) {
    return { status: 400, body: { success: false, error: 'Price must be greater than 0' } };
  }
  if (currency && !CURRENCIES.includes(String(currency).toUpperCase())) {
    return { status: 400, body: { success: false, error: 'Unsupported currency (EUR, USD or DZD)' } };
  }
  return null;
}

const findDish = (req, id) => get('SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?', [id, req.rid]);

router.get('/all', async (req, res) => {
  try {
    const { currency } = await getSettings(req.rid);
    const rows = await all('SELECT * FROM dishes WHERE restaurant_id = ? ORDER BY category, name', [req.rid]);
    ok(res, rows.map((row) => toMenuItem(row, currency)), { count: rows.length, currency });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/categories/all', async (req, res) => {
  try {
    const rows = await all(`
      SELECT category, COUNT(*) AS item_count FROM dishes
      WHERE restaurant_id = ? AND is_available = 1 AND category IS NOT NULL AND category != ''
      GROUP BY category ORDER BY category ASC
    `, [req.rid]);
    ok(res, rows, { count: rows.length });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/category/:category', async (req, res) => {
  try {
    const { currency } = await getSettings(req.rid);
    const rows = await all(
      'SELECT * FROM dishes WHERE restaurant_id = ? AND category = ? AND is_available = 1 ORDER BY name',
      [req.rid, req.params.category]
    );
    ok(res, rows.map((row) => toMenuItem(row, currency)), { count: rows.length });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/stats/overview', async (req, res) => {
  try {
    ok(res, await get(`
      SELECT COUNT(*) AS total_items,
             COUNT(CASE WHEN is_available = 1 THEN 1 END) AS available_items,
             COUNT(CASE WHEN is_available = 0 THEN 1 END) AS unavailable_items,
             COUNT(DISTINCT category) AS total_categories,
             AVG(price) AS average_price, MIN(price) AS min_price, MAX(price) AS max_price
      FROM dishes WHERE restaurant_id = ?
    `, [req.rid]));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await findDish(req, req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Menu item not found' });
    ok(res, toMenuItem(row, (await getSettings(req.rid)).currency));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/add', async (req, res) => {
  try {
    const invalid = validate(req.body);
    if (invalid) return res.status(invalid.status).json(invalid.body);
    const { name, description, price, category, image_url, available, currency } = req.body;
    await applyCurrency(req, currency);
    const image = normalizeImageUrl(image_url);
    const { lastID } = await run(
      `INSERT INTO dishes (restaurant_id, name, description, price, category, images, is_available) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.rid, name, description, Number(price), String(category).trim(), JSON.stringify(image ? [image] : []), available === false || available === 0 ? 0 : 1]
    );
    res.status(201).json({
      success: true,
      message: 'Menu item added successfully',
      data: toMenuItem(await findDish(req, lastID), (await getSettings(req.rid)).currency),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/update/:id', async (req, res) => {
  try {
    const current = await findDish(req, req.params.id);
    if (!current) return res.status(404).json({ success: false, error: 'Menu item not found' });
    const invalid = validate(req.body);
    if (invalid) return res.status(invalid.status).json(invalid.body);

    const { name, description, price, category, image_url, available, currency } = req.body;
    // L'écran de la caisse gère la photo principale ; les autres photos (ajoutées par l'admin) sont conservées
    const images = parseImages(current.images);
    const newMain = normalizeImageUrl(image_url);
    if (newMain !== (images[0] || null)) {
      const replaced = images[0];
      images.splice(0, 1, ...(newMain ? [newMain] : []));
      if (replaced) await releaseImages([replaced], current.id);
    }

    await run(
      `UPDATE dishes SET name = ?, description = ?, price = ?, category = ?, images = ?, is_available = ?,
              updated_at = CURRENT_TIMESTAMP WHERE id = ? AND restaurant_id = ?`,
      [name, description, Number(price), String(category).trim(), JSON.stringify(images),
        available === false || available === 0 ? 0 : 1, req.params.id, req.rid]
    );
    await applyCurrency(req, currency);
    res.json({
      success: true,
      message: 'Menu item updated successfully',
      data: toMenuItem(await findDish(req, req.params.id), (await getSettings(req.rid)).currency),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/delete/:id', async (req, res) => {
  try {
    const current = await get('SELECT id, images FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    if (!current) return res.status(404).json({ success: false, error: 'Menu item not found' });
    await run('DELETE FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    await releaseImages(parseImages(current.images), current.id);
    res.json({ success: true, message: 'Menu item deleted successfully' });
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/toggle/:id', async (req, res) => {
  try {
    const current = await get('SELECT id, is_available FROM dishes WHERE id = ? AND restaurant_id = ?', [req.params.id, req.rid]);
    if (!current) return res.status(404).json({ success: false, error: 'Menu item not found' });
    const available = current.is_available ? 0 : 1;
    await run('UPDATE dishes SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND restaurant_id = ?', [available, req.params.id, req.rid]);
    const row = await get('SELECT id, name, is_available FROM dishes WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      message: `Menu item ${available ? 'activated' : 'deactivated'} successfully`,
      data: { id: row.id, name: row.name, available: row.is_available },
    });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
