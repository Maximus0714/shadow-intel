import { buildDataset } from "./analysis.mjs";
import { analyzeLocalText } from "./documents.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const request = JSON.parse(input);
  const result = request.kind === "document" ? analyzeLocalText(request.text)
    : {...buildDataset(request.records, request.name), engine: "backend"};
  process.stdout.write(JSON.stringify({result}));
} catch (error) {
  process.stdout.write(JSON.stringify({error:error.message}));
  process.exitCode = 1;
}
