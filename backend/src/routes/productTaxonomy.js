const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const taxonomyService = require('../services/productTaxonomy');

const router = Router();

router.use(requireAuth);

router.get(
  '/:kind',
  asyncHandler(async (req, res) => {
    const rows = await taxonomyService.list(req, req.params.kind);
    res.json({ rows });
  })
);

router.post(
  '/:kind',
  asyncHandler(async (req, res) => {
    const row = await taxonomyService.create(req, req.params.kind, req.body);
    res.status(201).json(row);
  })
);

router.patch(
  '/:kind/:id',
  asyncHandler(async (req, res) => {
    const row = await taxonomyService.update(req, req.params.kind, req.params.id, req.body);
    res.json(row);
  })
);

router.delete(
  '/:kind/:id',
  asyncHandler(async (req, res) => {
    await taxonomyService.remove(req, req.params.kind, req.params.id);
    res.status(204).end();
  })
);

module.exports = router;
