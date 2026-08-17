const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const staffService = require('../services/staff');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const staff = await staffService.listStaff(req);
    res.json({ staff });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await staffService.updateStaffFlags(req, req.params.id, req.body);
    res.json(user);
  })
);

router.post(
  '/:id/reset-mfa',
  asyncHandler(async (req, res) => {
    const result = await staffService.resetMfa(req, req.params.id);
    res.json(result);
  })
);

module.exports = router;
