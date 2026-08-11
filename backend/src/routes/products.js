const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const productsService = require('../services/products');

const router = Router();

router.use(requireAuth);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const result = await productsService.runSync(req);
    res.json(result);
  })
);

router.post(
  '/bulk/add-to-portal',
  asyncHandler(async (req, res) => {
    const result = await productsService.bulkAddToPortal(req);
    res.json(result);
  })
);

router.post(
  '/:id/add-to-portal',
  asyncHandler(async (req, res) => {
    const product = await productsService.addToPortal(req, req.params.id);
    res.json(product);
  })
);

router.post(
  '/:id/remove-from-portal',
  asyncHandler(async (req, res) => {
    const product = await productsService.removeFromPortal(req, req.params.id);
    res.json(product);
  })
);

module.exports = router;
