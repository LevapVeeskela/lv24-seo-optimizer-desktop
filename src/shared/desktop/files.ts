import { invoke } from "@tauri-apps/api/core";

export interface WriteTextResult {
  path: string;
  bytes: number;
}

/**
 * Write a UTF-8 export through the shell's `write_text_file` command. The
 * shell only accepts paths under the app export directory and allow-listed
 * extensions, so a rejected path surfaces as a typed error instead of a silent
 * download failure.
 */
export async function writeTextFile(
  path: string,
  content: string,
): Promise<WriteTextResult> {
  return invoke<WriteTextResult>("write_text_file", { path, content });
}
