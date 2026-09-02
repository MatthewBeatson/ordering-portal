const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const skusService = require('../services/clientProductSkus');

const router = Router();

router.use(requireAuth);

router.get(
  '/:clientId',
  asyncHandler(async (req, res) => {
    const rows = await skusService.listForClient(req, req.params.clientId);
    res.json({ rows });
  })
);

router.patch(
  '/:clientId/:productId',
  asyncHandler(async (req, res) => {
    const row = await skusService.upsertSku(req, req.params.clientId, req.params.productId, req.body?.client_sku);
    res.json(row);
  })
);

router.delete(
  '/:clientId/:productId',
  asyncHandler(async (req, res) => {
    await skusService.removeSku(req, req.params.clientId, req.params.productId);
    res.status(204).end();
  })
);

module.exports = router;
