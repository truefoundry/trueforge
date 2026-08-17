/** `stat` / xfer probe output from sandboxed python. */
import { z } from 'zod';

export const XferFileInfoSchema = z.object({
  size: z.number(),
  isDir: z.boolean(),
});
export type XferFileInfo = z.infer<typeof XferFileInfoSchema>;
