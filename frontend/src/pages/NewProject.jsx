import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import client from "../api/client";
import Layout from "../components/Layout";

export default function NewProject() {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const inputClass =
    "w-full bg-panel border border-border rounded px-3 py-2 text-sm focus:border-running outline-none";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await client.post("/projects", { name, repository });
      navigate(`/deployments/new?project=${data._id}`);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create project.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">New Project</h1>
        <p className="text-muted text-sm mt-1">
          Register a GitHub repository so you can deploy it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm text-muted mb-1.5">Project name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="coupon-service"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1.5">GitHub repository URL</label>
          <input
            required
            type="url"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            className={inputClass}
            placeholder="https://github.com/acme/coupon-service"
          />
        </div>

        {error && (
          <p className="text-failed text-sm border border-failed/30 bg-failed/10 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="bg-running text-base font-medium rounded px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? "Creating..." : "Create project"}
          </button>
          <Link to="/" className="text-muted text-sm hover:text-text transition">
            Cancel
          </Link>
        </div>
      </form>
    </Layout>
  );
}
