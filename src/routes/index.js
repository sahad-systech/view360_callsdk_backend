const { Router } = require("express");
const homeController = require("../controllers/homeController");
const healthController = require("../controllers/healthController");
const tokenController = require("../controllers/tokenController");

const router = Router();
router.get("/", homeController.show);
router.get("/health", healthController.show);
router.post("/token", tokenController.create);

module.exports = router;
