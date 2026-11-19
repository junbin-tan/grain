// Native dialogs, with automatic answers when the GUI end-to-end runner is active.
import { ask, open, save } from "@tauri-apps/plugin-dialog";

type E2E = { exportDir?: string | null; importFile?: string | null } | undefined;
const e2e = (): E2E => (window as any).__grainE2E;

export async function confirm(message: string, opts: { title: string; okLabel: string }): Promise<boolean> {
  if (e2e()) return true;
  return ask(message, { title: opts.title, kind: "warning", okLabel: opts.okLabel });
}

export async function saveFile(defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const t = e2e();
  if (t?.exportDir) return `${t.exportDir}/${defaultPath}`;
  return save({ defaultPath, filters });
}

export async function openFolder(): Promise<string | null> {
  if (e2e()) return null;
  const r = await open({ multiple: false, directory: true });
  return typeof r === "string" ? r : null;
}

export async function openFile(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const t = e2e();
  if (t?.importFile) return t.importFile;
  const r = await open({ multiple: false, directory: false, filters });
  return typeof r === "string" ? r : null;
}
