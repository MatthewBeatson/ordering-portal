const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const clientsService = require('../services/clients');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clients = await clientsService.listManageableClients(req);
    res.json({ clients });
  })
);

router.post(
  '/:id/sync-addresses',
  asyncHandler(async (req, res) => {
    const result = await clientsService.syncAddresses(req, req.params.id);
    res.json(result);
  })
);

router.patch(
  '/:id/show-pricing',
  asyncHandler(async (req, res) => {
    const client = await clientsService.updateShowPricing(req, req.params.id, req.body?.show_pricing);
    res.json(client);
  })
);

module.exports = router;
