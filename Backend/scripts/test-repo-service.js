// Quick sanity check for src/services/repo.service.js.
// Usage: node scripts/test-repo-service.js
// Clones a tiny public repo into ./workspace and verifies detectProjectType.

const {
  cloneRepo,
  detectProjectType,
  sanitizeImageName,
  projectNameFromRepo,
  WORKSPACE_ROOT,
} = require("../src/services/repo.service");

const REPO_URL = "https://github.com/octocat/Hello-World";
const BRANCH = "master";

// Unit checks for the Docker image name sanitizer. Docker repo names may
// contain lowercase [a-z0-9._-]; the sanitizer lowercases and replaces
// anything outside that set (e.g. "@", "/", ":", whitespace) with "-".
// Underscores and dots are preserved because they are valid in image names.
const SANITIZE_CASES = [
  ["Hello-World", "hello-world"],
  ["My_App", "my_app"], // underscore is valid in Docker names
  ["UPPER.Case_Repo!", "upper.case_repo-"], // "." and "_" kept, "!" -> "-"
  ["already-lower", "already-lower"],
  ["123", "123"],
];

let unitOk = true;
for (const [input, expected] of SANITIZE_CASES) {
  const actual = sanitizeImageName(input);
  const ok = actual === expected && /^[a-z0-9._-]+$/.test(actual);
  if (!ok) {
    console.error(`FAIL sanitizeImageName("${input}") = "${actual}", expected "${expected}"`);
    unitOk = false;
  } else {
    console.log(`PASS sanitizeImageName("${input}") = "${actual}"`);
  }
}

const derived = projectNameFromRepo("https://github.com/acme/Hello-World");
if (derived !== "hello-world") {
  console.error(`FAIL projectNameFromRepo -> "${derived}", expected "hello-world"`);
  unitOk = false;
} else {
  console.log(`PASS projectNameFromRepo -> "${derived}"`);
}

if (!unitOk) process.exitCode = 1;

(async () => {
  try {
    console.log(`Cloning ${REPO_URL} (branch: ${BRANCH})...`);
    const dest = await cloneRepo(REPO_URL, BRANCH);
    console.log(`Cloned into: ${dest}`);
    console.log(`Expected under workspace root: ${dest.startsWith(WORKSPACE_ROOT) ? "ok" : "FAIL"}`);

    const type = await detectProjectType(dest);
    console.log(`Detected project type: ${type}`);

    if (!dest.startsWith(WORKSPACE_ROOT)) {
      throw new Error("Clone destination is outside the workspace root");
    }

    console.log("PASS");
  } catch (err) {
    console.error("FAIL", err);
    process.exitCode = 1;
  }
})();
