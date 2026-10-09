require('dotenv').config();
const { createApp } = require('./app');
const { startCancellationSyncTimer } = require('./integrations/cin7/cancellationSync');

const PORT = process.env.PORT || 3000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Ordering Portal API listening on port ${PORT}`);
  // While the server is awake, keep picking up orders voided in Cin7.
  startCancellationSyncTimer();
});
