const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const projectRoutes = require("./routes/project.routes");
const deploymentRoutes = require("./routes/deployment.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/" , (req,res)=>{
 return  res.json("Hello!!")
})

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/deployments", deploymentRoutes);

// 404 fallback
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// centralized error handler (catches anything thrown/rejected and not already handled)
app.use((err, req, res, next) => {
  // body-parser rejects malformed JSON bodies with type "entity.parse.failed";
  // report those as a 400 client error instead of a generic 500.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
