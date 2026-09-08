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

router.get(
  '/:id/users',
  asyncHandler(async (req, res) => {
    const users = await clientsService.listClientUsers(req, req.params.id);
    res.json({ users });
  })
);

router.patch(
  '/:id/users/:userId/default-shipping-address',
  asyncHandler(async (req, res) => {
    const result = await clientsService.setUserDefaultShippingAddress(req, req.params.id, req.params.userId, req.body?.address_id ?? null);
    res.json(result);
  })
);

module.exports = router;
