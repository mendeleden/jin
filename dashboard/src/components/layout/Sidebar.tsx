import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: "◉" },
  { to: "/sessions", label: "Sessions", icon: "◎" },
  { to: "/analytics", label: "Analytics", icon: "◇" },
  { to: "/projects", label: "Projects", icon: "◈" },
  { to: "/artifacts", label: "Artifacts", icon: "◆" },
  { to: "/feed", label: "Live Feed", icon: "●" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="px-4 py-5 border-b border-zinc-800">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-jin-400">jin</span>{" "}
          <span className="text-zinc-400 font-normal text-sm">dashboard</span>
        </h1>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )
            }
          >
            <span className="text-xs">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        jin v0.1.0
      </div>
    </aside>
  );
}
