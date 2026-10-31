import {readFile} from "node:fs/promises";
import {zipSync} from "fflate";

const files=["manifest.json","background.js","content.js","collector-core.mjs","collector-v2.mjs","workspace.js","auto.js","media-bridge.mjs","media-workspace.js","README.txt"];
export async function collectorExtension() {
  const entries=await Promise.all(files.map(async name=>["hot-monitor-collector/"+name,new Uint8Array(await readFile(new URL("../extension/"+name,import.meta.url)))] as const));
  return Buffer.from(zipSync(Object.fromEntries(entries),{level:6}));
}
