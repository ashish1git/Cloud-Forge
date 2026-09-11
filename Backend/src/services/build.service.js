const { execFile } = require("child_process");
const { promisify } = require("util");

// execFile runs a command without an intermediate shell, so arguments are
// never interpreted by a shell — this avoids shell-injection risks entirely.
//
// NOTE: buildImage uses promisified execFile, but pushImage deliberately does
// NOT — docker push streams progress output continuously and can run for
// minutes; the default maxBuffer (1MB) would kill the process with
// "maxBuffer length exceeded" once output grows past it, and there is no way
// to attach a timeout through the promisified form. The manual Promise in
// pushImage sets an explicit timeout, raises maxBuffer, and lets the process
// exit event settle the promise.
const PUSH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BUFFER = 50 * 1024 * 1024; // 50MB of output before giving up
const execFileAsync = promisify(execFile);

// Docker Hub requires a <username>/<image>:<tag> reference for pushes to a
// personal account; without the prefix it targets the official library
// namespace, which regular accounts cannot write to ("insufficient_scope").
// The username comes from DOCKER_REGISTRY_USERNAME in .env.
function getRegistryUsername() {
  const username = process.env.DOCKER_REGISTRY_USERNAME;
  if (!username) {
    throw new Error("DOCKER_REGISTRY_USERNAME is not configured");
  }
  return username;
}

// Full image reference, e.g. "23106031/test-node-app:v1788606996773".
function buildImageRef(imageName, tag) {
  return `${getRegistryUsername()}/${imageName}:${tag}`;
}

/**
 * Builds a Docker image from a cloned workspace directory.
 *
 * Tags the image as `<registryUsername>/<imageName>:<tag>` and builds with the
 * workspace as the build context. Assumes a Dockerfile is present in the
 * workspace root.
 *
 * @param {string} workspacePath Absolute path to the cloned repo folder
 * @param {string} imageName     Repository/image name, e.g. "coupon-service"
 * @param {string} tag           Image tag, e.g. "v1"
 * @returns {Promise<string>} The built image reference, e.g. "23106031/coupon-service:v1"
 */
async function buildImage(workspacePath, imageName, tag) {
  const imageRef = buildImageRef(imageName, tag);

  try {
    await execFileAsync("docker", ["build", "-t", imageRef, workspacePath], {
      maxBuffer: MAX_BUFFER,
    });
    return imageRef;
  } catch (err) {
    console.error("[build.buildImage] ", err.message);
    throw new Error(`Failed to build image ${imageRef}: ${err.message}`);
  }
}

/**
 * Pushes a Docker image to the configured registry.
 *
 * Resolves when the docker push process exits 0, rejects with a clear message
 * if the push exceeds PUSH_TIMEOUT_MS or the process fails.
 *
 * @param {string} imageRef Image reference to push, e.g. "23106031/coupon-service:v1"
 * @returns {Promise<string>} The pushed image reference
 */
async function pushImage(imageRef) {
  console.log("[build.pushImage] started: " + imageRef);

  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      ["push", imageRef],
      { maxBuffer: MAX_BUFFER, timeout: PUSH_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          // err.killed && err.signal === "SIGTERM" indicates the timeout fired.
          if (err.killed || err.code === null) {
            console.error("[build.pushImage] " + imageRef + " timed out after " + PUSH_TIMEOUT_MS + "ms");
            return reject(new Error(`docker push timed out after ${PUSH_TIMEOUT_MS / 1000}s: ${imageRef}`));
          }
          console.error("[build.pushImage] " + imageRef + " failed: " + err.message);
          return reject(new Error(`Failed to push image ${imageRef}: ${err.message}`));
        }
        console.log("[build.pushImage] completed: " + imageRef);
        resolve(imageRef);
      }
    );

    // Stream progress output to the terminal so a long push is visibly
    // progressing instead of looking stuck.
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  });
}

module.exports = { buildImage, pushImage, buildImageRef, getRegistryUsername };
