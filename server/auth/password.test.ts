import { describe, expect, it } from "vitest";
import { hashPassword, parseStoredHash, verifyPassword } from "./password";

const CUALQUIERA = "una-contraseña-totalmente-inventada";

describe("verifyPassword", () => {
  it("acepta la contraseña correcta y rechaza cualquier otra", () => {
    const stored = hashPassword("la-correcta");
    expect(verifyPassword("la-correcta", stored)).toBe(true);
    expect(verifyPassword("otra", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  // Regresión del bypass total de login: la clave se derivaba con la longitud del hash
  // guardado en vez de KEYLEN. Con el último campo vacío o no-hex quedaban 0 bytes
  // esperados y 0 derivados, y comparar dos buffers vacíos daba true: entraba cualquiera.
  // Disparador realista: pegar el hash cortado en el unit de systemd.
  it.each([
    ["último campo vacío", "scrypt:16384:8:1:aabb:"],
    ["último campo no-hex", "scrypt:16384:8:1:zz:zz"],
    ["hash truncado", "scrypt:16384:8:1:aabbccdd:00"],
    ["hash a la mitad", `scrypt:16384:8:1:aabb:${"a".repeat(64)}`],
    ["salt vacío", `scrypt:16384:8:1::${"a".repeat(128)}`],
    ["salt no-hex", `scrypt:16384:8:1:zzzz:${"a".repeat(128)}`],
  ])("no deja entrar con un hash mal formado: %s", (_etiqueta, stored) => {
    expect(verifyPassword(CUALQUIERA, stored)).toBe(false);
  });

  // Antes `Number("x")` daba NaN, scryptSync lanzaba y un login malo devolvía 500 en vez de 401.
  it.each([
    ["N no numérico", `scrypt:x:8:1:aabb:${"a".repeat(128)}`],
    ["r no numérico", `scrypt:16384:y:1:aabb:${"a".repeat(128)}`],
    ["p negativo", `scrypt:16384:8:-1:aabb:${"a".repeat(128)}`],
    ["N cero", `scrypt:0:8:1:aabb:${"a".repeat(128)}`],
  ])("rechaza sin lanzar excepción cuando los parámetros son inválidos: %s", (_e, stored) => {
    expect(() => verifyPassword(CUALQUIERA, stored)).not.toThrow();
    expect(verifyPassword(CUALQUIERA, stored)).toBe(false);
  });

  it.each([
    ["texto suelto", "no-es-un-hash"],
    ["faltan campos", "scrypt:16384:8:1:aabb"],
    ["sobran campos", `scrypt:16384:8:1:aabb:${"a".repeat(128)}:extra`],
    ["algoritmo desconocido", `bcrypt:16384:8:1:aabb:${"a".repeat(128)}`],
    ["cadena vacía", ""],
  ])("rechaza formatos que no son del esquema: %s", (_e, stored) => {
    expect(verifyPassword(CUALQUIERA, stored)).toBe(false);
  });
});

describe("parseStoredHash", () => {
  it("acepta lo que produce hashPassword", () => {
    const parsed = parseStoredHash(hashPassword("x"));
    expect(parsed).not.toBeNull();
    expect(parsed!.hash.length).toBe(64);
    expect(parsed!.N).toBe(16384);
  });

  it("devuelve null para un hash mal formado, que es lo que revisa el arranque", () => {
    expect(parseStoredHash("scrypt:16384:8:1:aabb:")).toBeNull();
  });
});
