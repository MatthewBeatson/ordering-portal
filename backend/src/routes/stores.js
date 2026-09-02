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

router.patch(
  '/:id/client-address',
  asyncHandler(async (req, res) => {
    const store = await storesService.updateClientAddress(req, req.params.id, req.body?.client_address_id ?? null);
    res.json(store);
  })
);

router.post(
  '/import-addresses',
  asyncHandler(async (req, res) => {
    const result = await storesService.importAddressMatches(req, req.body?.client_id, req.body?.rows);
    res.json(result);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const store = await storesService.createStore(req, req.body);
    res.status(201).json(store);
  })
);

module.exports = router;
