import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

const HEX = /^[0-9a-fA-F]+$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt:${SCRYPT_PARAMS.N}:${SCRYPT_PARAMS.r}:${SCRYPT_PARAMS.p}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

interface StoredHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** Entero positivo estricto: `Number("x")` es NaN y hacía reventar scryptSync con un 500. */
function enteroPositivo(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Valida el formato completo del hash guardado. Devuelve null si no parsea.
 *
 * Esto es lo que impide un bypass total de login: antes se derivaba la clave con
 * `expected.length` en vez de KEYLEN, así que un hash con el último campo vacío o no-hex
 * daba 0 bytes esperados, 0 bytes derivados, y `timingSafeEqual(vacío, vacío)` = true,
 * dejando entrar CUALQUIER contraseña. Un pegado cortado del hash en el unit de systemd
 * bastaba para abrir la aplicación entera.
 */
export function parseStoredHash(stored: string): StoredHash | null {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;

  const N = enteroPositivo(nStr);
  const r = enteroPositivo(rStr);
  const p = enteroPositivo(pStr);
  if (N === null || r === null || p === null) return null;

  // Longitud par y solo dígitos hex: si no, Buffer.from descarta lo que no entiende
  // en silencio y devuelve menos bytes de los que aparenta el texto.
  if (!HEX.test(saltHex) || saltHex.length % 2 !== 0) return null;
  if (!HEX.test(hashHex) || hashHex.length !== KEYLEN * 2) return null;

  const salt = Buffer.from(saltHex, "hex");
  if (salt.length === 0) return null;

  return { N, r, p, salt, hash: Buffer.from(hashHex, "hex") };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;

  // KEYLEN fijo, nunca una longitud derivada de la entrada.
  const actual = scryptSync(password, parsed.salt, KEYLEN, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
  });
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}
