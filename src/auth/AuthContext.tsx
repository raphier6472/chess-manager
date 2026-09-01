import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";

interface AuthContextValue {
  isOrganizer: boolean;
  organizerName: string | null;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setIsOrganizer(r.authenticated);
        setOrganizerName(r.organizerName);
      })
      // Un fallo de red o un 500 acá no debe quedar como unhandled rejection: se trata
      // como "no autenticado", igual que hace el servidor cuando no hay sesión válida.
      .catch(() => {
        setIsOrganizer(false);
        setOrganizerName(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (password: string) => {
    await api.login(password);
    setIsOrganizer(true);
    const r = await api.me();
    setOrganizerName(r.organizerName);
  };

  const logout = async () => {
    await api.logout();
    setIsOrganizer(false);
    setOrganizerName(null);
  };

  return (
    <AuthContext.Provider value={{ isOrganizer, organizerName, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
