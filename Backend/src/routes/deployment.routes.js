const express = require("express");
const { requireAuth } = require("../middleware/auth.middleware");
const {
  createDeployment,
  getDeployment,
  listDeployments,
  getLogs,
  scaleDeployment,
  restartDeployment,
  deleteDeployment,
} = require("../controllers/deployment.controller");

const router = express.Router();

router.use(requireAuth);

router.post("/", createDeployment);
router.get("/", listDeployments);
router.get("/:id", getDeployment);
router.get("/:id/logs", getLogs);
router.post("/:id/scale", scaleDeployment);
router.post("/:id/restart", restartDeployment);
router.delete("/:id", deleteDeployment);

module.exports = router;
