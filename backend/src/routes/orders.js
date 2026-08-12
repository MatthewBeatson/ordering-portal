const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const ordersService = require('../services/orders');

const router = Router();

router.use(requireAuth);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const order = await ordersService.createOrder(req);
    res.status(201).json(order);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await ordersService.listOrders(req);
    res.json(result);
  })
);

// Bulk actions before the /:id routes so 'bulk' doesn't get captured
// as an :id param.
router.post(
  '/bulk/ship',
  asyncHandler(async (req, res) => {
    const result = await ordersService.markShipped(req);
    res.json(result);
  })
);

router.post(
  '/bulk/confirm',
  asyncHandler(async (req, res) => {
    const result = await ordersService.bulkConfirm(req);
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await ordersService.getOrder(req, req.params.id);
    res.json(order);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await ordersService.deleteOrder(req, req.params.id);
    res.status(204).send();
  })
);

router.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    const order = await ordersService.confirmOrder(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const order = await ordersService.rejectOrder(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/flag',
  asyncHandler(async (req, res) => {
    const order = await ordersService.flagOrder(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/clear-flag',
  asyncHandler(async (req, res) => {
    const order = await ordersService.clearFlag(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/retry-sync',
  asyncHandler(async (req, res) => {
    const order = await ordersService.retrySync(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/request-cancellation',
  asyncHandler(async (req, res) => {
    const order = await ordersService.requestCancellation(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/resolve-cancellation',
  asyncHandler(async (req, res) => {
    const order = await ordersService.resolveCancellation(req, req.params.id);
    res.json(order);
  })
);

module.exports = router;
