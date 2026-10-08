import { createFileRoute } from "@tanstack/react-router";

// The home page is served directly by src/server.ts (the lost and found page),
// so this route only renders if someone reaches it through client navigation.
export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#120f1d", color: "#e6e1f2", fontFamily: "system-ui, sans-serif" }}>
      <a href="/" style={{ color: "#f3d79f" }}>Go to the Iluminar lost and found</a>
    </main>
  );
}
