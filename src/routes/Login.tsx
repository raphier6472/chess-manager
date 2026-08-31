import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("la contraseña es obligatoria");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await login(password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Acceso</p>
          <h1>Organizador</h1>
        </div>
      </div>

      <form className="card" style={{ padding: "1.1rem", maxWidth: "22rem" }} onSubmit={submit} noValidate>
        <div className="form-row">
          <div className="field" style={{ flex: "1 1 auto" }}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn--felt" disabled={saving}>
            {saving ? "Ingresando…" : "Ingresar"}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  );
}
