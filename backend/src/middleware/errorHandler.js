const multer = require('multer');
const { ApiError } = require('../lib/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // multer throws its own error type (before the route handler even
  // runs, e.g. LIMIT_FILE_SIZE) -- without this it'd fall through to
  // an unhelpful generic 500.
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFoundHandler, errorHandler };
