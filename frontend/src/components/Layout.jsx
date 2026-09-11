import Sidebar from "./Sidebar";

export default function Layout({ children }) {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 px-8 py-8 max-w-5xl">{children}</main>
    </div>
  );
}
