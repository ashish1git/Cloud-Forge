// Integration-style lifecycle test for CloudForge deployments.
//
// Usage (requires a running backend + a live Kubernetes cluster, e.g. Minikube):
//   1. Start the backend:  npm run dev   (or node src/server.js)
//   2. Ensure a cluster is reachable: kubectl config current-context
//   3. Run:               node scripts/test-lifecycle.js
//
// Flow: register user -> create project -> create deployment ->
//       poll until "running" -> fetch logs -> scale to 3 -> verify via
//       k8s getStatus -> restart -> delete -> confirm status "deleted".
//
// This is a plain console.log checkpoint script, matching the style of
// test-repo-service.js / test-k8s-render.js — not a formal test framework.

const BASE_URL = process.env.CLOUDFORGE_BASE_URL || "http://localhost:5000";
const REPO_URL = process.env.CLOUDFORGE_REPO_URL || "https://github.com/octocat/Hello-World";
const BRANCH = process.env.CLOUDFORGE_BRANCH || "master";

const { spawnSync } = require("child_process");

function checkCluster() {
  const ctx = spawnSync("kubectl", ["config", "current-context"], { encoding: "utf8" });
  if (ctx.status !== 0 || !ctx.stdout.trim()) {
    console.error("PRECONDITION FAIL: no Kubernetes context. Start Minikube (minikube start) and point kubectl at it.");
    process.exit(1);
  }
  console.log(`Using kubectl context: ${ctx.stdout.trim()}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body (e.g. empty)
  }
  return { status: res.status, data };
}

const step = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  try {
    checkCluster();

    const email = `lifecycle-${Date.now()}@example.com`;
    const password = "testpass123";

    // 1. Register a fresh user (gets us a JWT + creates the project owner).
    const reg = await api("POST", "/api/auth/register", {
      body: { name: "Lifecycle Tester", email, password },
    });
    step("register user", reg.status === 201, JSON.stringify(reg.data?.user || reg.data));
    if (reg.status !== 201) throw new Error("could not register");
    const token = reg.data.token;

    // 2. Create a project pointing at a tiny public repo.
    const proj = await api("POST", "/api/projects", {
      token,
      body: { name: `lc-${Date.now()}`, repository: REPO_URL },
    });
    step("create project", proj.status === 201, JSON.stringify(proj.data?._id || proj.data));
    if (proj.status !== 201) throw new Error("could not create project");
    const projectId = proj.data._id;

    // 3. Create a deployment (202 Accepted — pipeline runs in the background).
    const dep = await api("POST", "/api/deployments", {
      token,
      body: {
        projectId,
        branch: BRANCH,
        environment: "development",
        replicas: 1,
        cpu: "250m",
        memory: "256Mi",
        port: 8080,
      },
    });
    step("create deployment (202)", dep.status === 202, JSON.stringify(dep.data));
    if (dep.status !== 202) throw new Error("could not create deployment");
    const deploymentId = dep.data.deploymentId;

    // 4. Poll the deployment until it reaches "running" (or "failed").
    const deadline = Date.now() + 120_000;
    let deploymentDoc = null;
    let pollMsg = "";
    while (Date.now() < deadline) {
      const poll = await api("GET", `/api/deployments/${deploymentId}`, { token });
      if (poll.status !== 200) {
        pollMsg = `GET returned ${poll.status}`;
        break;
      }
      deploymentDoc = poll.data;
      if (deploymentDoc.status === "running" || deploymentDoc.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    step(
      "deployment reached running",
      deploymentDoc && deploymentDoc.status === "running",
      deploymentDoc ? `status=${deploymentDoc.status}` : pollMsg
    );
    if (!deploymentDoc || deploymentDoc.status !== "running") {
      throw new Error("deployment did not reach running (check server log / image build)");
    }
    const image = deploymentDoc.image;
    const url = deploymentDoc.url;
    step("image populated", !!image, image || "");
    step("url populated", !!url, url || "");

    // 5. Fetch logs.
    const logs = await api("GET", `/api/deployments/${deploymentId}/logs`, { token });
    step("fetch logs (200)", logs.status === 200, logs.status === 200 ? `"${(logs.data?.logs || "").slice(0, 80)}..."` : JSON.stringify(logs.data));
    if (logs.status !== 200) throw new Error("could not fetch logs");

    // 6. Scale to 3 and confirm the deployment doc + live cluster both show 3.
    const scaled = await api("POST", `/api/deployments/${deploymentId}/scale`, {
      token,
      body: { replicas: 3 },
    });
    step("scale to 3 (200)", scaled.status === 200, JSON.stringify(scaled.data));
    if (scaled.status !== 200) throw new Error("could not scale");

    const projectName = REPO_URL.split("/").pop().replace(/\.git$/, "");
    const ns = "development";
    const live = await require("../src/services/k8s.service").getStatus(projectName, ns);
    step("cluster replicas == 3", live.spec?.replicas === 3, `spec.replicas=${live.spec?.replicas}`);
    if (live.spec?.replicas !== 3) throw new Error("cluster did not scale to 3");

    // 7. Restart.
    const restarted = await api("POST", `/api/deployments/${deploymentId}/restart`, { token });
    step("restart (200)", restarted.status === 200, JSON.stringify(restarted.data));
    if (restarted.status !== 200) throw new Error("could not restart");

    // 8. Delete and confirm the deployment document flips to "deleted".
    const del = await api("DELETE", `/api/deployments/${deploymentId}`, { token });
    step("delete (200)", del.status === 200, JSON.stringify(del.data));
    if (del.status !== 200) throw new Error("could not delete");

    const after = await api("GET", `/api/deployments/${deploymentId}`, { token });
    step("deployment status == deleted", after.data?.status === "deleted", `status=${after.data?.status}`);

    console.log("\nDONE — lifecycle test finished.");
  } catch (err) {
    console.error("FAIL", err.message);
    process.exitCode = 1;
  }
})();
