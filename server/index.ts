import { createApp } from "./app";

const app = createApp();

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`enroque server listening on :${port}`);
});
