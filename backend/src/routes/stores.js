const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const storesService = require('../services/stores');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const stores = await storesService.listManageableStores(req);
    res.json({ stores });
  })
);

router.patch(
  '/:id/store-number',
  asyncHandler(async (req, res) => {
    const store = await storesService.updateStoreNumber(req, req.params.id, req.body?.store_number);
    res.json(store);
  })
);

module.exports = router;
