import { Outlet } from "react-router-dom";
import { TopNav } from "./TopNav";

export function Shell() {
  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-ink-100">
      <TopNav />
      <div className="flex-1 flex relative overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
