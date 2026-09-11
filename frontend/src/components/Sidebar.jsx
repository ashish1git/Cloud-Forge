import { useAuth } from "../context/AuthContext";

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-56 shrink-0 bg-panel border-r border-border flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-border">
        <span className="font-semibold tracking-tight">CloudForge</span>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        <a
          href="/"
          className="block px-3 py-2 rounded text-sm text-text hover:bg-panelhover transition"
        >
          Deployments
        </a>
        {/* TODO: add Projects, Logs nav items once those pages exist */}
      </nav>

      <div className="px-4 py-4 border-t border-border">
        <p className="text-sm text-text truncate">{user?.name}</p>
        <p className="text-xs text-muted truncate mb-2">{user?.email}</p>
        <button
          onClick={logout}
          className="text-xs text-muted hover:text-failed transition"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
