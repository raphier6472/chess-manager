import { createInterface } from "node:readline/promises";
import { hashPassword } from "../auth/password";

async function readPasswordFromStdin(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "Password del organizador (se muestra en pantalla, no queda en el historial de shell): ",
  );
  rl.close();
  return answer.trim();
}

async function main() {
  const argPassword = process.argv[2];
  const password = argPassword ?? (await readPasswordFromStdin());
  if (!password) {
    console.error("Se necesita un password (argumento o stdin).");
    process.exit(1);
  }
  console.log(hashPassword(password));
}

main();
