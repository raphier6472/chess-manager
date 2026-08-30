import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import TournamentList from "./routes/TournamentList";
import Championship from "./routes/Championship";
import TournamentShell from "./routes/TournamentShell";
import Players from "./routes/Players";
import RoundPage from "./routes/Round";
import Standings from "./routes/Standings";
import Login from "./routes/Login";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<TournamentList />} />
            <Route path="campeonato" element={<Championship />} />
            <Route path="login" element={<Login />} />
            <Route path="t/:tournamentId" element={<TournamentShell />}>
              <Route index element={<Navigate to="players" replace />} />
              <Route path="players" element={<Players />} />
              <Route path="round" element={<RoundPage />} />
              <Route path="standings" element={<Standings />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
