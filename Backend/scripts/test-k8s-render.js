// Quick sanity check for src/services/k8s.service.js renderManifest in isolation.
// Usage: node scripts/test-k8s-render.js
// Verifies the Deployment and Service templates render correctly WITHOUT reaching a cluster.

const { renderManifest, renderServiceManifest } = require("../src/services/k8s.service");

const values = {
  PROJECT_NAME: "coupon-service",
  NAMESPACE: "development",
  REPLICAS: 3,
  IMAGE: "coupon-service:v1",
  PORT: 8080,
  CPU: "500m",
  MEMORY: "512Mi",
  CPU_LIMIT: "1",
  MEMORY_LIMIT: "1Gi",
};

(async () => {
  try {
    const yamlOut = await renderManifest(values);
    console.log("Rendered Deployment manifest:\n");
    console.log(yamlOut);

    const checks = [
      ["name", /name: coupon-service/],
      ["namespace", /namespace: development/],
      ["replicas", /replicas: 3/],
      ["image", /image: coupon-service:v1/],
      ["port", /containerPort: 8080/],
      ["cpu request", /cpu: 500m/],
      ["memory request", /memory: 512Mi/],
      ["cpu limit", /cpu: 1/],
      ["memory limit", /memory: 1Gi/],
    ];

    let ok = true;
    for (const [label, re] of checks) {
      if (!re.test(yamlOut)) {
        console.error(`FAIL: missing ${label}`);
        ok = false;
      }
    }

    // spot-check the Deployment YAML round-trips through the k8s loader
    const { loadAllYaml } = require("@kubernetes/client-node");
    const [obj] = loadAllYaml(yamlOut);
    if (obj.kind !== "Deployment") throw new Error("kind is not Deployment");
    if (obj.spec.replicas !== 3) throw new Error("replicas not parsed");
    // js-yaml parses a bare `1` as a number; both string "1" and number 1 are
    // valid cpu limits for Kubernetes.
    const cpuLimit = obj.spec.template.spec.containers[0].resources.limits.cpu;
    if (String(cpuLimit) !== "1") {
      throw new Error("cpu limit not parsed");
    }

    // Service template round-trip
    const svcYaml = await renderServiceManifest({
      PROJECT_NAME: "coupon-service",
      NAMESPACE: "development",
      PORT: 8080,
      SERVICE_TYPE: "LoadBalancer",
    });
    console.log("\nRendered Service manifest:\n");
    console.log(svcYaml);
    const [svc] = loadAllYaml(svcYaml);
    if (svc.kind !== "Service") throw new Error("kind is not Service");
    if (svc.spec.type !== "LoadBalancer") throw new Error("service type is not LoadBalancer");
    if (svc.spec.selector.app !== "coupon-service") throw new Error("selector mismatch");
    if (svc.spec.ports[0].port !== 8080) throw new Error("port mismatch");

    console.log(ok ? "\nPASS" : "\nFAIL");
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error("FAIL", err);
    process.exitCode = 1;
  }
})();
