const express = require("express");
const cors = require("cors");
const routes = require("./routes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(routes);

if (require.main === module) {
  const config = require("./config/environment");
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Token server running on port ${config.port}`);
  });
}

module.exports = app;
