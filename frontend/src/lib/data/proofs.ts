export interface ProofReceipt {
  version: string;
  salt: string;
  digest: string;
  transaction_hash: string;
  block_hash: string;
  block_number: number;
  chain_id: number;
}

export interface SavedFingerprint {
  id: string;
  name: string;
  saved_at: string;
  nodes: number;
  records: number;
  receipt: ProofReceipt;
  evidence: { name: string; records: Record<string, unknown>[]; source_text: string };
}

function key(userId: string) { return `xt-fingerprints:${userId}`; }

export function readFingerprints(userId: string): SavedFingerprint[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) || "[]");
    return Array.isArray(value) ? value.filter(item => item?.receipt?.digest && item?.evidence?.records) : [];
  } catch { return []; }
}

export function saveFingerprint(userId: string, item: SavedFingerprint) {
  const existing = readFingerprints(userId).filter(saved => saved.id !== item.id);
  localStorage.setItem(key(userId), JSON.stringify([item, ...existing].slice(0, 50)));
}

export function evidenceKey(row: Record<string, unknown>) {
  return [row.src, row.dst, row.rel, row.date, row.amount, row.currency].map(value => String(value || "")).join("\u001f");
}

export function compareEvidence(current: Record<string, unknown>[], saved: Record<string, unknown>[]) {
  const currentMap = new Map(current.map(row => [evidenceKey(row), row]));
  const savedMap = new Map(saved.map(row => [evidenceKey(row), row]));
  const added: Record<string, unknown>[] = [], removed: Record<string, unknown>[] = [], changed: {before: Record<string, unknown>; after: Record<string, unknown>}[] = [];
  for (const [key, row] of currentMap) {
    if (!savedMap.has(key)) added.push(row);
    else if (Number(row.frequency || 1) !== Number(savedMap.get(key)?.frequency || 1)) changed.push({before: savedMap.get(key)!, after: row});
  }
  for (const [key, row] of savedMap) if (!currentMap.has(key)) removed.push(row);
  return {added, removed, changed, unchanged: currentMap.size - added.length - changed.length};
}
