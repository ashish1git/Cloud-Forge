const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: ["deploy", "scale", "restart", "delete"], required: true },
    deployment: { type: mongoose.Schema.Types.ObjectId, ref: "Deployment", required: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
