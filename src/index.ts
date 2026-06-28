import "dotenv/config";
import { app } from "./app";
import { startAlertScheduler } from "./lib/alerts";

const PORT = Number(process.env.PORT) || 3001;
const HOST = "0.0.0.0"; // bind all interfaces (required by Render/most PaaS)

app.listen(PORT, HOST, () => {
  console.log(`Quill API listening on ${HOST}:${PORT}`);
  startAlertScheduler();
});
