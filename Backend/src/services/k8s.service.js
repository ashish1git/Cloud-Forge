const fs = require("fs/promises");
const path = require("path");
const { Writable } = require("stream");
const {
  KubeConfig,
  KubernetesObjectApi,
  Log,
  loadAllYaml,
} = require("@kubernetes/client-node");
const yaml = require("js-yaml");

const TEMPLATE_DIR = path.join(__dirname, "..", "templates");
const DEPLOYMENT_TEMPLATE = path.join(TEMPLATE_DIR, "deployment.yaml");
const SERVICE_TEMPLATE = path.join(TEMPLATE_DIR, "service.yaml");

// KubeConfig is created lazily on first API call. loadFromDefault() reads
// ~/.kube/config, or the in-cluster env when running inside a pod; on Windows
// it may shell out to wsl.exe, so we defer it until the k8s service is actually
// used rather than at require time. No connection is made here either way —
// connections happen lazily per API call.
let kc;
function getKubeConfig() {
  if (!kc) {
    kc = new KubeConfig();
    kc.loadFromDefault();
  }
  return kc;
}

function getObjectApi() {
  return KubernetesObjectApi.makeApiClient(getKubeConfig());
}

/**
 * Renders the Deployment manifest from src/templates/deployment.yaml.
 *
 * @param {object} templateValues Values to substitute into the template
 * @returns {Promise<string>} Rendered YAML string
 */
async function renderManifest(templateValues) {
  return renderTemplate(DEPLOYMENT_TEMPLATE, templateValues);
}

/**
 * Renders the Service manifest from src/templates/service.yaml.
 *
 * @param {object} templateValues Values to substitute into the template
 * @returns {Promise<string>} Rendered YAML string
 */
async function renderServiceManifest(templateValues) {
  return renderTemplate(SERVICE_TEMPLATE, templateValues);
}

async function renderTemplate(templateFile, templateValues) {
  const template = await fs.readFile(templateFile, "utf8");
  const manifest = template.replace(
    /\{\{(\w+)\}\}/g,
    (_m, key) => (templateValues[key] === undefined ? "" : String(templateValues[key]))
  );
  return manifest;
}

/**
 * Ensures a Kubernetes namespace exists, creating it if absent.
 *
 * @param {string} namespace Namespace name
 * @returns {Promise<object>} The (existing or newly created) Namespace object
 */
async function ensureNamespace(namespace) {
  const api = getObjectApi();
  const spec = { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace } };

  try {
    return await api.read(spec);
  } catch (err) {
    if (err.code === 404) {
      return api.create(spec);
    }
    throw err;
  }
}

/**
 * Resolves the node IP to use in the externally reachable URL.
 *
 * Prefers the NODE_IP env var (e.g. `minikube ip` for Minikube), then falls
 * back to the InternalIP of the first cluster node.
 *
 * @returns {Promise<string>} Node IP
 */
async function getNodeIp() {
  if (process.env.NODE_IP) {
    return process.env.NODE_IP;
  }

  const api = getObjectApi();
  const nodes = await api.list("v1", "Node");

  for (const node of nodes.items || []) {
    const internalIp = (node.status?.addresses || []).find((a) => a.type === "InternalIP");
    if (internalIp) return internalIp.address;
  }

  throw new Error("No node IP available: set NODE_IP or ensure the cluster has a node with an InternalIP");
}

/**
 * Applies a Deployments manifest to the cluster.
 *
 * Uses server-side apply semantics via KubernetesObjectApi: creates the
 * Deployment if it does not exist, otherwise replaces it.
 *
 * @param {string} yamlString Deployments manifest as YAML
 * @returns {Promise<object>} The applied Deployment object
 */
async function applyManifest(yamlString) {
  const [deployment] = loadAllYaml(yamlString);
  const api = getObjectApi();

  try {
    // Read to see if it already exists; 404 means create, otherwise replace.
    await api.read(deployment);
    return await api.replace(deployment);
  } catch (err) {
    if (err.code === 404) {
      return await api.create(deployment);
    }
    throw err;
  }
}

/**
 * Reads the status of a Deployment by name.
 *
 * @param {string} name Deployment name
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<object>} Deployment object with live status
 */
async function getStatus(name, namespace = "default") {
  const api = getObjectApi();
  return api.read({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  });
}

/**
 * Reads logs from the first pod in the Deployment.
 *
 * @param {string} name Deployment name
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<string>} Raw container logs
 */
async function getLogs(name, namespace = "default") {
  const api = getObjectApi();
  const deployment = await api.read({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  });

  const labelSelector =
    deployment.spec.selector.matchLabels &&
    Object.entries(deployment.spec.selector.matchLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");

  const pods = await api.list("v1", "Pod", namespace, undefined, undefined, undefined, undefined, labelSelector);
  const pod = pods.items && pods.items[0];

  if (!pod) {
    throw new Error(`No pods found for deployment ${name}`);
  }

  const containerName = deployment.spec.template.spec.containers[0]?.name || name;

  let result = "";
  const sink = new Writable({
    write(chunk, _enc, cb) {
      result += chunk.toString();
      cb();
    },
  });

  const log = new Log(getKubeConfig());
  await log.log(namespace, pod.metadata.name, containerName, sink);
  await new Promise((resolve, reject) => {
    sink.on("finish", resolve);
    sink.on("error", reject);
  });

  return result;
}

/**
 * Resolves the externally reachable URL for a LoadBalancer Service.
 *
 * Returns null (not an error) while the load balancer ingress is still
 * pending — e.g. `minikube tunnel` is not running yet, or the cloud LB is
 * still provisioning. Callers can poll a few times before giving up.
 *
 * @param {string} name Service name
 * @param {string} namespace Namespace (defaults to "default")
 * @param {number} port Service port to use in the URL
 * @returns {Promise<string|null>} e.g. "http://127.0.0.1:8080", or null while pending
 */
async function getLoadBalancerUrl(name, namespace = "default", port) {
  const api = getObjectApi();
  const service = await api.read({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace },
  });

  const ingress = service.status?.loadBalancer?.ingress;
  const host = ingress?.[0]?.ip || ingress?.[0]?.hostname;
  if (!host) return null;

  return `http://${host}:${port}`;
}

/**
 * Reads the nodePort allocated to a Service by name. Used only when
 * SERVICE_TYPE=NodePort (no LoadBalancer controller available).
 *
 * @param {string} name Service name
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<number>} The allocated nodePort
 */
async function getNodePort(name, namespace = "default") {
  const api = getObjectApi();
  const service = await api.read({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace },
  });

  const nodePort = service.spec.ports?.[0]?.nodePort;
  if (!nodePort) {
    throw new Error(`No nodePort allocated for service ${name}`);
  }
  return nodePort;
}

/**
 * Scales a Deployment to the given number of replicas.
 *
 * @param {string} name Deployment name
 * @param {number} replicas Desired replica count
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<object>} The patched Deployment
 */
async function scale(name, replicas, namespace = "default") {
  const api = getObjectApi();
  const deployment = await api.read({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  });

  deployment.spec.replicas = replicas;
  return api.replace(deployment);
}

/**
 * Restarts a Deployment by rolling out (bumping the pod template annotation).
 *
 * @param {string} name Deployment name
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<object>} The patched Deployment
 */
async function restart(name, namespace = "default") {
  const api = getObjectApi();
  const deployment = await api.read({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  });

  deployment.spec.template.metadata = deployment.spec.template.metadata || {};
  deployment.spec.template.metadata.annotations = {
    ...(deployment.spec.template.metadata.annotations || {}),
    "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
  };
  return api.replace(deployment);
}

/**
 * Deletes a Deployment by name.
 *
 * A 404 from the cluster means the Deployment never existed (e.g. the
 * pipeline failed before anything was applied) — that is treated as "already
 * gone" and resolves normally so callers can proceed with cleanup. Only
 * genuine errors reject.
 *
 * @param {string} name Deployment name
 * @param {string} [namespace] Namespace (defaults to "default")
 * @returns {Promise<object|null>} Delete status, or null if the Deployment did not exist
 */
async function deleteDeployment(name, namespace = "default") {
  const api = getObjectApi();
  try {
    return await api.delete({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name, namespace },
    });
  } catch (err) {
    if (err.code === 404) {
      return null;
    }
    throw err;
  }
}

module.exports = {
  renderManifest,
  renderServiceManifest,
  applyManifest,
  ensureNamespace,
  getNodeIp,
  getStatus,
  getLogs,
  getLoadBalancerUrl,
  getNodePort,
  scale,
  restart,
  deleteDeployment,
};
