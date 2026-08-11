const express = require('express');
const cors = require('cors');
const ordersRouter = require('./routes/orders');
const productsRouter = require('./routes/products');
const cin7WebhookRouter = require('./integrations/cin7/webhook');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/orders', ordersRouter);
  app.use('/products', productsRouter);
  // Not under requireAuth -- Cin7 isn't a Supabase user. Authenticated
  // via a bearer token instead, checked inside the router itself.
  app.use('/webhooks/cin7', cin7WebhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
