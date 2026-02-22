import { Routes, Route } from "react-router-dom";
import Shell from "./components/layout/Shell";
import Dashboard from "./pages/Dashboard";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import Analytics from "./pages/Analytics";
import Projects from "./pages/Projects";
import Artifacts from "./pages/Artifacts";
import Feed from "./pages/Feed";

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/artifacts" element={<Artifacts />} />
        <Route path="/feed" element={<Feed />} />
      </Routes>
    </Shell>
  );
}
