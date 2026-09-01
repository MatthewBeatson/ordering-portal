const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const attributesService = require('../services/clientProductAttributes');

const router = Router();

router.use(requireAuth);

router.get(
  '/:clientId',
  asyncHandler(async (req, res) => {
    const rows = await attributesService.listForClient(req, req.params.clientId);
    res.json({ rows });
  })
);

router.patch(
  '/:clientId/:productId',
  asyncHandler(async (req, res) => {
    const row = await attributesService.upsertOverride(req, req.params.clientId, req.params.productId, req.body);
    res.json(row);
  })
);

router.delete(
  '/:clientId/:productId',
  asyncHandler(async (req, res) => {
    await attributesService.removeOverride(req, req.params.clientId, req.params.productId);
    res.status(204).end();
  })
);

module.exports = router;
