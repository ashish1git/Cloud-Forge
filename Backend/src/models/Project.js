const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    repository: {
      type: String,
      required: true,
      match: [/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, "Must be a valid GitHub repository URL"],
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
