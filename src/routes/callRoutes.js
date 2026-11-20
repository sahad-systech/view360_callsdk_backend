const { Router } = require("express");
const callController = require("../controllers/callController");
const authenticate = require("../middleware/auth");

const router = Router();

router.post("/initiate", authenticate, callController.initiate);
router.post("/accept", authenticate, callController.accept);

module.exports = router;
