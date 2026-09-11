const git = require("simple-git");
const fs = require("fs/promises");
const path = require("path");

// Workspace for cloned repos, created at runtime by cloneRepo(). Kept OUT of
// nodemon's watch (see nodemon.json): if nodemon watched this dir it would
// restart the server mid-clone, killing the git process and leaving a partial
// checkout with no error thrown. Any new runtime-written dir must be added to
// nodemon.json ignore too.
const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

// Maps a detected marker file to a human-readable project type.
const PROJECT_TYPES = {
  "package.json": "node",
  "requirements.txt": "python",
  "pom.xml": "java",
  "go.mod": "go",
};

// Language-specific Dockerfile templates used when a cloned repo has no
// Dockerfile of its own. Only "node" and "python" have templates today; any
// other detected type fails fast with a clear error instead of a confusing
// docker build failure.
const DOCKERFILE_TEMPLATES = {
  node: "node.dockerfile",
  python: "python.dockerfile",
};

const DOCKERFILE_TEMPLATES_ROOT = path.join(__dirname, "..", "templates", "dockerfiles");

// Docker image names must be lowercase and may only contain [a-z0-9._-].
// Anything else (uppercase letters, slashes, colons, @, whitespace, ...) is
// replaced with "-" so a repo slug like "Hello-World" or "My_App" becomes a
// valid image name component.
function sanitizeImageName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

/**
 * Derives a deployable resource name (Docker image name, Deployment name,
 * Service name) from a repository URL.
 *
 * @param {string} repoUrl Full repository URL (e.g. "https://github.com/owner/Hello-World")
 * @returns {string} e.g. "hello-world"
 */
function projectNameFromRepo(repoUrl) {
  const slug = repoUrl.split("/").pop().replace(/\.git$/, "");
  return sanitizeImageName(slug);
}

/**
 * Clones a repository into a per-deployment folder under ./workspace.
 *
 * The folder name is derived from the repo URL so multiple deployments of the
 * same project (or different projects) never collide: e.g.
 *   https://github.com/acme/coupon-service -> workspace/acme-coupon-service
 *
 * @param {string} repoUrl  Full repository URL (e.g. "https://github.com/owner/repo")
 * @param {string} branch   Branch or tag to check out (defaults to "main")
 * @returns {Promise<string>} Absolute path to the cloned workspace folder
 */
async function cloneRepo(repoUrl, branch = "main") {
  const folderName = repoUrl
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\//g, "-");

  const dest = path.join(WORKSPACE_ROOT, folderName);

  // Fresh workspace per deploy: remove any prior clone so re-runs are idempotent.
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });

  try {
    await git(dest).clone(repoUrl, ".", ["--branch", branch]);
  } catch (err) {
    // git errors are verbose dumps (remote URL, exit codes, etc.); replace
    // them with a single user-facing line. The original is kept on the error
    // for server-side debugging.
    console.error("[repo.cloneRepo] ", err.message);
    throw new Error(
      "Could not clone repository: check that the URL is correct and the repository is public."
    );
  }

  return dest;
}

/**
 * Checks whether the workspace already contains a Dockerfile.
 *
 * @param {string} workspacePath Absolute path to a cloned repo folder
 * @returns {Promise<boolean>} true if a Dockerfile exists at the root
 */
async function hasDockerfile(workspacePath) {
  try {
    await fs.access(path.join(workspacePath, "Dockerfile"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the workspace has a Dockerfile, generating one from the
 * language-specific template matching the detected project type when missing.
 *
 * @param {string} workspacePath Absolute path to a cloned repo folder
 * @param {string|null} projectType Detected type ("node", "python", ...) or null
 * @returns {Promise<boolean>} true if a Dockerfile is present or was generated
 * @throws {Error} If no Dockerfile exists and no template covers the type
 */
async function ensureDockerfile(workspacePath, projectType) {
  if (await hasDockerfile(workspacePath)) {
    return true;
  }

  const templateFile = DOCKERFILE_TEMPLATES[projectType];
  if (!templateFile) {
    throw new Error(
      `No Dockerfile found and no template available for detected type: ${projectType || "unknown"}`
    );
  }

  const template = await fs.readFile(path.join(DOCKERFILE_TEMPLATES_ROOT, templateFile), "utf8");
  await fs.writeFile(path.join(workspacePath, "Dockerfile"), template);
  return true;
}

/**
 * Detects the project type from well-known marker files inside a workspace.
 *
 * Checks (in priority order): package.json, requirements.txt, pom.xml, go.mod.
 * Returns the first match, or null when none of the markers are present.
 *
 * @param {string} workspacePath Absolute path to a cloned repo folder
 * @returns {Promise<string|null>} e.g. "node", "python", "java", "go", or null
 */
async function detectProjectType(workspacePath) {
  for (const marker of Object.keys(PROJECT_TYPES)) {
    try {
      await fs.access(path.join(workspacePath, marker));
      return PROJECT_TYPES[marker];
    } catch {
      // marker not present, keep checking
    }
  }
  return null;
}

module.exports = {
  cloneRepo,
  detectProjectType,
  hasDockerfile,
  ensureDockerfile,
  sanitizeImageName,
  projectNameFromRepo,
  WORKSPACE_ROOT,
  PROJECT_TYPES,
};
