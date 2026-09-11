const Deployment = require("../models/Deployment");
const Project = require("../models/Project");
const AuditLog = require("../models/AuditLog");
const fs = require("fs/promises");
const net = require("net");
const repoService = require("../services/repo.service");
const buildService = require("../services/build.service");
const k8sService = require("../services/k8s.service");

const MAX_REPLICAS = 10;
const MAX_CPU_CORES = 2; // e.g. "2" cores as a platform-enforced ceiling
const MAX_MEMORY_MI = 2048; // 2Gi

// Local-dev only. When the backend runs on the same machine as Minikube +
// `minikube tunnel`, a LoadBalancer Service binds the requested port on the
// host. If another local process (pgAdmin, Apache, anything) already holds
// that port, the OS routes the tunnel's traffic to that process instead of
// the deployed app — so deployments to such ports must be rejected up front.
// This is irrelevant in the cloud (Phase 2 / k3s), where the Service port is
// only bound inside the cluster, hence the LOCAL_DEV gate.
const IS_LOCAL_DEV = process.env.LOCAL_DEV === "true";
const SERVICE_TYPE = process.env.SERVICE_TYPE || "LoadBalancer";

// Tries to bind the requested port on the host. Rejects the deployment if the
// port is already taken, so a "successful" deploy can never silently serve the
// wrong process via the tunnel.
//
// Binds 0.0.0.0 (the wildcard) because that is where host processes hold the
// port; binding 127.0.0.1 when 0.0.0.0 is taken returns EACCES on Windows
// rather than EADDRINUSE, and the tunnel itself binds 127.0.0.1 — so both
// codes are treated as "in use".
function assertHostPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        reject(
          new Error(
            `Port ${port} is already in use on this machine by another process. Choose a different port for this deployment.`
          )
        );
      } else {
        reject(new Error(`Could not verify port ${port} is free: ${err.message}`));
      }
    });
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve());
    });
  });
}

function parseCpuToCores(cpu) {
  // supports "500m" (millicores) or "1" (whole cores)
  if (typeof cpu !== "string") return NaN;
  if (cpu.endsWith("m")) return parseInt(cpu, 10) / 1000;
  return parseFloat(cpu);
}

function parseMemoryToMi(memory) {
  // supports "512Mi" or "1Gi"
  if (typeof memory !== "string") return NaN;
  if (memory.endsWith("Gi")) return parseFloat(memory) * 1024;
  if (memory.endsWith("Mi")) return parseFloat(memory);
  return NaN;
}

async function createDeployment(req, res) {
  try {
    const { projectId, branch, environment, replicas, cpu, memory, port } = req.body;

    // --- Validation (platform policy enforced server-side, never trust the frontend) ---
    if (!projectId || !replicas || !cpu || !memory || !port) {
      return res.status(400).json({
        error: "projectId, replicas, cpu, memory and port are required",
      });
    }

    const project = await Project.findOne({ _id: projectId, owner: req.user.id });
    if (!project) {
      return res.status(404).json({ error: "Project not found or not owned by this user" });
    }

    if (replicas < 1 || replicas > MAX_REPLICAS) {
      return res.status(400).json({ error: `replicas must be between 1 and ${MAX_REPLICAS}` });
    }

    const cpuCores = parseCpuToCores(cpu);
    if (isNaN(cpuCores) || cpuCores <= 0 || cpuCores > MAX_CPU_CORES) {
      return res.status(400).json({ error: `cpu must be a valid value up to ${MAX_CPU_CORES} cores` });
    }

    const memoryMi = parseMemoryToMi(memory);
    if (isNaN(memoryMi) || memoryMi <= 0 || memoryMi > MAX_MEMORY_MI) {
      return res.status(400).json({ error: `memory must be a valid value up to ${MAX_MEMORY_MI}Mi` });
    }

    if (port < 1 || port > 65535) {
      return res.status(400).json({ error: "port must be between 1 and 65535" });
    }

    // --- Persist as "pending" ---
    const deployment = await Deployment.create({
      project: project._id,
      branch: branch || "main",
      environment: environment || "development",
      replicas,
      cpu,
      memory,
      port,
      status: "pending",
      createdBy: req.user.id,
    });

    // Kick off the async deployment pipeline without blocking the response.
    // Status transitions follow the Deployment STATUSES enum; the pipeline
    // catches its own errors and flips the record to "failed" on failure.
    runDeploymentPipeline(deployment, project);

    return res.status(202).json({ deploymentId: deployment._id, status: deployment.status });
  } catch (err) {
    console.error("[deployment.create] ", err);
    return res.status(500).json({ error: "Could not create deployment" });
  }
}

async function getDeployment(req, res) {
  try {
    const deployment = await Deployment.findById(req.params.id).populate("project");
    if (!deployment) {
      return res.status(404).json({ error: "Deployment not found" });
    }
    // TODO (next step): merge in live pod status from k8s.service.getStatus()
    return res.status(200).json(deployment);
  } catch (err) {
    console.error("[deployment.get] ", err);
    return res.status(500).json({ error: "Could not fetch deployment" });
  }
}

async function listDeployments(req, res) {
  try {
    const projects = await Project.find({ owner: req.user.id }).select("_id");
    const projectIds = projects.map((p) => p._id);
    const deployments = await Deployment.find({ project: { $in: projectIds } })
      .populate("project")
      .sort({ createdAt: -1 });
    return res.status(200).json(deployments);
  } catch (err) {
    console.error("[deployment.list] ", err);
    return res.status(500).json({ error: "Could not fetch deployments" });
  }
}

// Loads a deployment owned by req.user and returns it (or sends a 404 and
// returns null). Shared by every lifecycle action below.
async function findOwnedDeployment(req, res) {
  const deployment = await Deployment.findById(req.params.id).populate("project");
  if (!deployment || !deployment.project || deployment.project.owner.toString() !== req.user.id) {
    res.status(404).json({ error: "Deployment not found" });
    return null;
  }
  return deployment;
}

async function getLogs(req, res) {
  try {
    const deployment = await findOwnedDeployment(req, res);
    if (!deployment) return;

    // No live pods yet while the pipeline is still cloning/building/deploying.
    if (deployment.status !== "running") {
      return res.status(409).json({ error: "Deployment is not running yet" });
    }

    const projectName = repoService.projectNameFromRepo(deployment.project.repository);
    const namespace = deployment.environment || "development";
    const logs = await k8sService.getLogs(projectName, namespace);

    return res.status(200).json({ logs });
  } catch (err) {
    console.error("[deployment.logs] ", err);
    return res.status(500).json({ error: "Could not fetch deployment logs" });
  }
}

async function scaleDeployment(req, res) {
  try {
    const deployment = await findOwnedDeployment(req, res);
    if (!deployment) return;

    const { replicas } = req.body;
    if (!replicas || replicas < 1 || replicas > MAX_REPLICAS) {
      return res.status(400).json({ error: `replicas must be between 1 and ${MAX_REPLICAS}` });
    }

    const fromReplicas = deployment.replicas;
    const projectName = repoService.projectNameFromRepo(deployment.project.repository);
    const namespace = deployment.environment || "development";

    await k8sService.scale(projectName, replicas, namespace);

    deployment.replicas = replicas;
    await deployment.save();

    await AuditLog.create({
      user: req.user.id,
      action: "scale",
      deployment: deployment._id,
      metadata: { fromReplicas, toReplicas: replicas },
    });

    return res.status(200).json({ status: "ok", replicas });
  } catch (err) {
    console.error("[deployment.scale] ", err);
    return res.status(500).json({ error: "Could not scale deployment" });
  }
}

async function restartDeployment(req, res) {
  try {
    const deployment = await findOwnedDeployment(req, res);
    if (!deployment) return;

    const projectName = repoService.projectNameFromRepo(deployment.project.repository);
    const namespace = deployment.environment || "development";

    await k8sService.restart(projectName, namespace);

    await AuditLog.create({
      user: req.user.id,
      action: "restart",
      deployment: deployment._id,
      metadata: {},
    });

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[deployment.restart] ", err);
    return res.status(500).json({ error: "Could not restart deployment" });
  }
}

async function deleteDeployment(req, res) {
  try {
    const deployment = await findOwnedDeployment(req, res);
    if (!deployment) return;

    const projectName = repoService.projectNameFromRepo(deployment.project.repository);
    const namespace = deployment.environment || "development";

    await k8sService.deleteDeployment(projectName, namespace);

    deployment.status = "deleted";
    await deployment.save();

    await AuditLog.create({
      user: req.user.id,
      action: "delete",
      deployment: deployment._id,
      metadata: {},
    });

    return res.status(200).json({ status: "deleted" });
  } catch (err) {
    console.error("[deployment.delete] ", err);
    return res.status(500).json({ error: "Could not delete deployment" });
  }
}

async function runDeploymentPipeline(deployment, project) {
  const setStatus = async (status, extra = {}) => {
    deployment.status = status;
    deployment.set(extra);
    await deployment.save();
  };

  let workspacePath = null;

  try {
    // Fail fast before doing any work: pushing to Docker Hub needs the account
    // username prefix; without it docker push fails with a confusing
    // "insufficient_scope" error, so validate up front.
    buildService.getRegistryUsername();

    // Resource name shared by the image, Deployment and Service. Sanitized so
    // a repo like "Hello-World" yields a valid lowercase Docker image name.
    const projectName = repoService.projectNameFromRepo(project.repository);
    const namespace = deployment.environment || "development";

    // Local-dev pre-flight: with SERVICE_TYPE=LoadBalancer + LOCAL_DEV=true
    // (Minikube + tunnel on this machine), the requested Service port must be
    // free on the host or tunnel traffic will hit whatever process owns it.
    // Fail before any clone/build work.
    if (IS_LOCAL_DEV && SERVICE_TYPE === "LoadBalancer") {
      await assertHostPortFree(deployment.port);
    }

    // 1. Clone the repo into a per-deployment workspace folder.
    await setStatus("cloning");
    workspacePath = await repoService.cloneRepo(project.repository, deployment.branch);

    // 2. Detect the project type so the build step can pick the right image tag.
    const projectType = await repoService.detectProjectType(workspacePath);

    // 3. If the repo has no Dockerfile, generate one from the template that
    //    matches the detected project type (node/python). Unknown types with
    //    no template fail fast with a clear message.
    await repoService.ensureDockerfile(workspacePath, projectType);

    // 4. Build and push the container image.
    await setStatus("building");
    const imageRef = await buildService.buildImage(workspacePath, projectName, `v${Date.now()}`);

    await setStatus("pushing");
    await buildService.pushImage(imageRef);
    deployment.image = imageRef;
    await deployment.save();

    // 5. Make sure the target namespace exists before applying anything.
    await setStatus("deploying");
    await k8sService.ensureNamespace(namespace);

    // 6. Render and apply the Deployment manifest, then a matching NodePort Service.
    const manifest = await k8sService.renderManifest({
      PROJECT_NAME: projectName,
      NAMESPACE: namespace,
      REPLICAS: deployment.replicas,
      IMAGE: imageRef,
      PORT: deployment.port,
      CPU: deployment.cpu,
      MEMORY: deployment.memory,
      CPU_LIMIT: deployment.cpu,
      MEMORY_LIMIT: deployment.memory,
    });
    await k8sService.applyManifest(manifest);

    const serviceYaml = await k8sService.renderServiceManifest({
      PROJECT_NAME: projectName,
      NAMESPACE: namespace,
      PORT: deployment.port,
      SERVICE_TYPE,
    });
    await k8sService.applyManifest(serviceYaml);

    // 7. Mark as running and expose the URL. LoadBalancer services only get an
    //    external IP while `minikube tunnel` (or a cloud LB) is active. Poll
    //    for it while the status stays "deploying" (the frontend keeps polling
    //    until a terminal state), so the URL appears automatically as soon as
    //    the tunnel assigns an address. Give up after ~90s and mark it running
    //    with an empty url rather than staying "deploying" forever.
    let deploymentUrl = null;
    if (SERVICE_TYPE === "LoadBalancer") {
      for (let attempt = 0; attempt < 18; attempt++) {
        deploymentUrl = await k8sService.getLoadBalancerUrl(projectName, namespace, deployment.port);
        if (deploymentUrl) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    } else {
      // NodePort fallback (e.g. SERVICE_TYPE=NodePort on a bare cluster): the
      // URL needs the node IP.
      const nodeIp = await k8sService.getNodeIp();
      const nodePort = await k8sService.getNodePort(projectName, namespace);
      deploymentUrl = `http://${nodeIp}:${nodePort}`;
    }

    if (deploymentUrl) deployment.url = deploymentUrl;
    await setStatus("running");
  } catch (err) {
    console.error("[deployment.pipeline] ", err);
    await setStatus("failed", { errorMessage: err.message });
  } finally {
    // Free disk: remove the cloned workspace whether the pipeline succeeded or failed.
    if (workspacePath) {
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error("[deployment.pipeline] cleanup failed: ", cleanupErr.message);
      }
    }
  }
}

module.exports = {
  createDeployment,
  getDeployment,
  listDeployments,
  getLogs,
  scaleDeployment,
  restartDeployment,
  deleteDeployment,
};
