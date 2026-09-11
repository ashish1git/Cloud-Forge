import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(name, email, password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">CloudForge</h1>
          <p className="text-muted text-sm mt-1">Create your developer account.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1.5">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm focus:border-running outline-none"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm focus:border-running outline-none"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm focus:border-running outline-none"
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <p className="text-failed text-sm border border-failed/30 bg-failed/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-running text-base font-medium rounded px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-muted text-sm mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-running hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
