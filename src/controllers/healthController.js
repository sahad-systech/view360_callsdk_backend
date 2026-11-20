const view = require("../views/json");

function show(req, res) {
  return res.json(view.health());
}

module.exports = { show };
