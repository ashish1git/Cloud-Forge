import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import client from "../api/client";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";

export default function Dashboard() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchDeployments();
  }, []);

  async function fetchDeployments() {
    try {
      const { data } = await client.get("/deployments");
      setDeployments(data);
    } catch (err) {
      setError("Could not load deployments.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deployments</h1>
          <p className="text-muted text-sm mt-1">
            {deployments.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/projects/new"
            className="bg-panel border border-border text-text text-sm font-medium px-4 py-2 rounded hover:bg-panelhover transition"
          >
            + New Project
          </Link>
          <button
            onClick={() => navigate("/deployments/new")}
            className="bg-running text-base text-sm font-medium px-4 py-2 rounded hover:opacity-90 transition"
          >
            + Create Deployment
          </button>
        </div>
      </div>

      {loading && <p className="text-muted text-sm">Loading...</p>}
      {error && <p className="text-failed text-sm">{error}</p>}

      {!loading && !error && deployments.length === 0 && (
        <div className="border border-dashed border-border rounded-lg py-16 text-center">
          <p className="text-muted text-sm">
            No deployments yet. Create your first one to get started.
          </p>
        </div>
      )}

      {deployments.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-panel border-b border-border text-left text-muted text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Replicas</th>
                <th className="px-4 py-2.5 font-medium">Port</th>
                <th className="px-4 py-2.5 font-medium">Environment</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr
                  key={d._id}
                  className="border-b border-border last:border-0 hover:bg-panel transition"
                >
                  <td className="px-4 py-3">
                    {/* TODO: link to /deployments/:id detail page once built */}
                    <Link to={`/deployments/${d._id}`} className="hover:text-running">
                      {d.project?.name || "unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-muted">{d.replicas}</td>
                  <td className="px-4 py-3 font-mono text-muted">{d.port}</td>
                  <td className="px-4 py-3 text-muted">{d.environment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
