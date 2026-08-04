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

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await ordersService.getOrder(req, req.params.id);
    res.json(order);
  })
);

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const order = await ordersService.approveOrder(req, req.params.id);
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

module.exports = router;
