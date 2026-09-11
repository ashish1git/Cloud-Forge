const mongoose = require("mongoose");

const STATUSES = [
  "pending",
  "cloning",
  "building",
  "pushing",
  "deploying",
  "running",
  "failed",
  "stopped",
  "deleted",
];

const deploymentSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    branch: { type: String, default: "main" },
    environment: {
      type: String,
      enum: ["development", "staging", "production"],
      default: "development",
    },
    image: { type: String }, // populated once build succeeds, e.g. "coupon-service:v1"
    replicas: { type: Number, required: true, min: 1, max: 10 },
    cpu: { type: String, required: true }, // e.g. "500m"
    memory: { type: String, required: true }, // e.g. "512Mi"
    port: { type: Number, required: true, min: 1, max: 65535 },
    status: { type: String, enum: STATUSES, default: "pending" },
    url: { type: String },
    errorMessage: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Deployment", deploymentSchema);
module.exports.STATUSES = STATUSES;
