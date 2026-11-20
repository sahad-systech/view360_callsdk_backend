const app = require("./app");
const config = require("./config/environment");

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Token server running on port ${config.port}`);
});
