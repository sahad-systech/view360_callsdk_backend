const { Router } = require("express");
const userController = require("../controllers/userController");
const User = require("../models/user");

const router = Router();

// Optional authentication middleware: if Authorization or x-user-id header is provided, attach req.user
async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const xUserId = req.headers["x-user-id"];
  const token =
    authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")
      ? authHeader.trim().substring(7).trim()
      : xUserId
      ? String(xUserId).trim()
      : null;

  if (token) {
    try {
      const user = await User.findById(token);
      if (user) {
        req.user = user;
      }
    } catch {
      // Proceed without req.user; controller will validate userId from body
    }
  }
  return next();
}

router.post("/register", userController.registerUser);
router.post("/", userController.registerUser);
router.get("/:id", userController.getUser);
router.post("/fcm-token", optionalAuthenticate, userController.registerFcmToken);

module.exports = router;
