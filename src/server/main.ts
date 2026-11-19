import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildApp();
const address = await app.listen({ port, host });
console.log(`API listening on ${address}`);
