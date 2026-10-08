const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const approvalBatchesService = require('../services/approvalBatches');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await approvalBatchesService.listBatches(req));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await approvalBatchesService.getBatch(req, req.params.id));
  })
);

module.exports = router;
