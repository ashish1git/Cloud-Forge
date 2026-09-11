const STATUS_STYLES = {
  running: "bg-running/10 text-running border-running/30",
  building: "bg-building/10 text-building border-building/30",
  pushing: "bg-building/10 text-building border-building/30",
  cloning: "bg-building/10 text-building border-building/30",
  deploying: "bg-building/10 text-building border-building/30",
  pending: "bg-pending/10 text-pending border-pending/30",
  failed: "bg-failed/10 text-failed border-failed/30",
  stopped: "bg-pending/10 text-pending border-pending/30",
  deleted: "bg-pending/10 text-pending border-pending/30",
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-mono ${style}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
