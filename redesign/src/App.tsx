import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { RouterProvider, useRoute } from "./lib/router";
import { Home } from "./pages/Home";
import { Models } from "./pages/Models";
import { Playground } from "./pages/Playground";
import { Docs } from "./pages/Docs";
import { Chat } from "./pages/Chat";
import { Login } from "./pages/Login";
import { Keys } from "./pages/Keys";
import { Admin } from "./pages/Admin";

function View() {
  const { path } = useRoute();
  if (path === "/models") return <Models />;
  if (path === "/playground") return <Playground />;
  if (path === "/chat") return <Chat />;
  if (path === "/docs") return <Docs />;
  if (path === "/login") return <Login />;
  if (path === "/keys") return <Keys />;
  if (path === "/admin") return <Admin />;
  return <Home />;
}

export default function App() {
  return (
    <RouterProvider>
      {/* The column rules are drawn once behind everything and never scroll,
          so content aligns to a field rather than each section inventing one. */}
      <div className="rules" aria-hidden>
        <div className="rules-inner">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      <div className="relative z-10">
        <Nav />
        <main>
          <View />
        </main>
        <Footer />
      </div>
    </RouterProvider>
  );
}
