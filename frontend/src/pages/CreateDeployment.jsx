import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import client from "../api/client";
import Layout from "../components/Layout";

export default function CreateDeployment() {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState("main");
  const [environment, setEnvironment] = useState("development");
  const [replicas, setReplicas] = useState("1");
  const [cpu, setCpu] = useState("250m");
  const [memory, setMemory] = useState("256Mi");
  const [port, setPort] = useState("8080");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    try {
      const { data } = await client.get("/projects");
      setProjects(data);
      const preselected = searchParams.get("project");
      if (preselected && data.some((p) => p._id === preselected)) {
        setProjectId(preselected);
      } else if (data.length === 1) {
        setProjectId(data[0]._id);
      }
    } catch (err) {
      setLoadError("Could not load projects.");
    } finally {
      setLoadingProjects(false);
    }
  }

  const inputClass =
    "w-full bg-panel border border-border rounded px-3 py-2 text-sm focus:border-running outline-none";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { data } = await client.post("/deployments", {
        projectId,
        branch,
        environment,
        replicas: parseInt(replicas, 10),
        cpu,
        memory,
        port: parseInt(port, 10),
      });
      navigate(`/deployments/${data.deploymentId}`);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create deployment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Create Deployment</h1>
        <p className="text-muted text-sm mt-1">
          Configure and kick off a new deployment.
        </p>
      </div>

      {loadingProjects && <p className="text-muted text-sm">Loading...</p>}

      {loadError && (
        <div>
          <p className="text-failed text-sm">{loadError}</p>
        </div>
      )}

      {!loadingProjects && !loadError && projects.length === 0 && (
        <div className="border border-dashed border-border rounded-lg py-16 text-center">
          <p className="text-muted text-sm mb-3">
            You need a project before you can deploy.
          </p>
          <Link
            to="/projects/new"
            className="inline-block bg-running text-base text-sm font-medium px-4 py-2 rounded hover:opacity-90 transition"
          >
            + New Project
          </Link>
        </div>
      )}

      {!loadingProjects && !loadError && projects.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
          <div>
            <label htmlFor="cf-project" className="block text-sm text-muted mb-1.5">
              Project
            </label>
            <select
              id="cf-project"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Select a project...
              </option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cf-branch" className="block text-sm text-muted mb-1.5">
                Branch
              </label>
              <input
                id="cf-branch"
                required
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className={inputClass}
                placeholder="main"
              />
            </div>
            <div>
              <label htmlFor="cf-environment" className="block text-sm text-muted mb-1.5">
                Environment
              </label>
              <select
                id="cf-environment"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className={inputClass}
              >
                <option value="development">development</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cf-replicas" className="block text-sm text-muted mb-1.5">
                Replicas
              </label>
              <input
                id="cf-replicas"
                type="number"
                required
                min="1"
                max="10"
                value={replicas}
                onChange={(e) => setReplicas(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="cf-port" className="block text-sm text-muted mb-1.5">
                Port
              </label>
              <input
                id="cf-port"
                type="number"
                required
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cf-cpu" className="block text-sm text-muted mb-1.5">
                CPU
              </label>
              <input
                id="cf-cpu"
                required
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
                className={inputClass}
                placeholder="250m"
              />
              <p className="text-xs text-muted mt-1">e.g. 250m, 1, 2</p>
            </div>
            <div>
              <label htmlFor="cf-memory" className="block text-sm text-muted mb-1.5">
                Memory
              </label>
              <input
                id="cf-memory"
                required
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                className={inputClass}
                placeholder="256Mi"
              />
              <p className="text-xs text-muted mt-1">e.g. 256Mi, 1Gi</p>
            </div>
          </div>

          {error && (
            <p className="text-failed text-sm border border-failed/30 bg-failed/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !projectId}
              className="bg-running text-base font-medium rounded px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
            >
              {submitting ? "Creating..." : "Deploy"}
            </button>
            <Link to="/" className="text-muted text-sm hover:text-text transition">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </Layout>
  );
}
