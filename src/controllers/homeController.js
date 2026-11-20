const path = require("node:path");

function show(req, res) {
  return res.sendFile(path.join(__dirname, "../views/home.html"));
}

module.exports = { show };
