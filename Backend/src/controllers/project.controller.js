const Project = require("../models/Project");

async function createProject(req, res) {
  try {
    const { name, repository } = req.body;

    if (!name || !repository) {
      return res.status(400).json({ error: "name and repository are required" });
    }

    const project = await Project.create({
      name,
      repository,
      owner: req.user.id,
    });

    return res.status(201).json(project);
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    console.error("[project.create] ", err);
    return res.status(500).json({ error: "Could not create project" });
  }
}

async function listProjects(req, res) {
  try {
    const projects = await Project.find({ owner: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json(projects);
  } catch (err) {
    console.error("[project.list] ", err);
    return res.status(500).json({ error: "Could not fetch projects" });
  }
}

module.exports = { createProject, listProjects };
