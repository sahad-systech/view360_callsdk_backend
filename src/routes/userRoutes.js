const { Router } = require("express");
const userController = require("../controllers/userController");
const authenticate = require("../middleware/auth");

const router = Router();

router.post("/fcm-token", authenticate, userController.registerFcmToken);
router.delete("/fcm-token", authenticate, userController.removeFcmToken);

module.exports = router;
