import fs from "node:fs";
import path from "node:path";
const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run import-config -- <configuration-file>");
  process.exit(1);
}
const rows = fs
  .readFileSync(input, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const key = rows.find((s) => /^sk-[\w-]+$/.test(s));
const base = rows.find((s) => /^https?:\/\//.test(s));
const model = rows.find((s) => s !== key && s !== base);
if (!key || !base || !model)
  throw new Error("Expected API key, base URL and model on separate lines.");
const target = path.resolve(".env");
let env = fs.existsSync(target)
  ? fs.readFileSync(target, "utf8")
  : fs.readFileSync(".env.example", "utf8");
for (const [name, value] of Object.entries({
  LLM_API_KEY: key,
  LLM_BASE_URL: base,
  LLM_MODEL: model,
})) {
  const line = `${name}=${JSON.stringify(value)}`;
  env = new RegExp(`^${name}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${name}=.*$`, "m"), () => line)
    : `${env}\n${line}`;
}
fs.writeFileSync(target, env, { mode: 0o600 });
console.log(
  "Imported model configuration into ignored .env. Secret values are hidden.",
);
