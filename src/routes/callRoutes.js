const { Router } = require("express");
const callController = require("../controllers/callController");
const authenticate = require("../middleware/auth");

const router = Router();

router.post("/initiate", authenticate, callController.initiate);
router.post("/accept", authenticate, callController.accept);
router.post("/reject", authenticate, callController.reject);
router.post("/end", authenticate, callController.endCall);
router.get("/history", authenticate, callController.getHistory);
router.get("/:callId", authenticate, callController.getDetails);
router.post("/cancel", authenticate, callController.cancel);

module.exports = router;
