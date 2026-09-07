const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const rulesService = require('../services/customGroupRules');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await rulesService.list(req);
    res.json({ rows });
  })
);

router.put(
  '/:trayProductId',
  asyncHandler(async (req, res) => {
    const result = await rulesService.setForTray(req, req.params.trayProductId, req.body.insert_product_ids);
    res.json(result);
  })
);

router.delete(
  '/:trayProductId',
  asyncHandler(async (req, res) => {
    await rulesService.removeTray(req, req.params.trayProductId);
    res.status(204).end();
  })
);

module.exports = router;
