import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./app/Shell";
import { AtlasPage } from "./features/atlas/AtlasPage";
import { TwinPage } from "./features/twin/TwinPage";
import { PriorityPage } from "./features/priority/PriorityPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<AtlasPage />} />
          <Route path="twin/:roadId" element={<TwinPage />} />
          <Route path="priority" element={<PriorityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
