import { buildDataset } from "./local";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ dataset: buildDataset(data.records, data.name) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
