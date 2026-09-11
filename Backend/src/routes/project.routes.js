const express = require("express");
const { requireAuth } = require("../middleware/auth.middleware");
const { createProject, listProjects } = require("../controllers/project.controller");

const router = express.Router();

router.use(requireAuth); // every route below requires a logged-in user

router.post("/", createProject);
router.get("/", listProjects);

module.exports = router;
