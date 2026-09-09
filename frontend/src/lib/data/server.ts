import { supabase } from "../auth";
import type { CleanedEdge } from "./upload";
import type { LocalDataset } from "../analysis/local";
import { ANALYSIS_VERSION } from "../analysis/local";

/** Relative URLs work unchanged in development and behind the deployment proxy. */
export async function postWorkspace<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const response = await fetch(`/api/workspace/${path}`, {
      method: "POST",
      headers: { ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(session ? {Authorization: `Bearer ${session.access_token}`} : {}) },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    const content = response.headers.get("content-type") || "";
    if (!content.includes("application/json"))
      throw new Error(
        "The analysis service is unavailable. Start the backend and retry.",
      );
    const result = await response.json();
    if (!response.ok) {
      const detail =
        typeof result.detail === "string"
          ? result.detail
          : Array.isArray(result.detail)
            ? result.detail.map((e: { msg: string }) => e.msg).join("; ")
            : `Analysis failed (${response.status}). Please retry.`;
      throw new Error(detail);
    }
    return result as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Analysis timed out. Try a smaller dataset.");
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach the backend. Check your connection and retry.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeOnServer(records: CleanedEdge[], name: string, sourceText = "") {
  const result = await postWorkspace<LocalDataset>("analyze", { records, name, source_text: sourceText });
  if (result.analysis_version !== ANALYSIS_VERSION)
    throw new Error(
      "The backend analysis version does not match this website. Deploy matching frontend and backend images together.",
    );
  return result;
}
