const { Router } = require("express");
const homeController = require("../controllers/homeController");
const healthController = require("../controllers/healthController");
const tokenController = require("../controllers/tokenController");
const callRoutes = require("./callRoutes");
const userRoutes = require("./userRoutes");

const router = Router();
router.get("/", homeController.show);
router.get("/health", healthController.show);
router.post("/token", tokenController.create);
router.use("/api/calls", callRoutes);
router.use("/api/users", userRoutes);

module.exports = router;
