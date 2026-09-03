const { Router } = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const productsService = require('../services/products');
const displaySystemsService = require('../services/productDisplaySystems');

const router = Router();
// Memory storage -- product photos are small, no need to touch disk.
// Actual size/type validation happens in the service (uploadImage),
// this cap just stops an oversized request from being buffered at all.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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
    const product = await productsService.addToPortal(req, req.params.id, req.body?.client_id);
    res.json(product);
  })
);

router.post(
  '/:id/remove-from-portal',
  asyncHandler(async (req, res) => {
    const product = await productsService.removeFromPortal(req, req.params.id, req.body?.client_id);
    res.json(product);
  })
);

router.patch(
  '/:id/taxonomy',
  asyncHandler(async (req, res) => {
    const product = await productsService.updateTaxonomy(req, req.params.id, req.body);
    res.json(product);
  })
);

router.post(
  '/bulk/update-taxonomy',
  asyncHandler(async (req, res) => {
    const result = await productsService.bulkUpdateTaxonomy(req, req.body?.product_ids, req.body);
    res.json(result);
  })
);

router.put(
  '/:id/display-systems',
  asyncHandler(async (req, res) => {
    const result = await displaySystemsService.setForProduct(req, req.params.id, req.body?.display_system_ids);
    res.json(result);
  })
);

router.post(
  '/bulk/add-display-systems',
  asyncHandler(async (req, res) => {
    const result = await displaySystemsService.bulkAdd(req, req.body?.product_ids, req.body?.display_system_ids);
    res.json(result);
  })
);

router.post(
  '/bulk/remove-display-systems',
  asyncHandler(async (req, res) => {
    const result = await displaySystemsService.bulkRemove(req, req.body?.product_ids, req.body?.display_system_ids);
    res.json(result);
  })
);

router.post(
  '/:id/images',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const image = await productsService.uploadImage(req, req.params.id);
    res.status(201).json(image);
  })
);

router.delete(
  '/images/:imageId',
  asyncHandler(async (req, res) => {
    await productsService.deleteImage(req, req.params.imageId);
    res.status(204).send();
  })
);

module.exports = router;
