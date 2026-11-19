import { z } from '@hono/zod-openapi';

export const ArtifactKindSchema = z
  .enum(['html', 'markdown', 'mixed'])
  .describe('Rendered content type of the artifact.')
  .openapi('ArtifactKind');

export const ArtifactVersionStatusSchema = z
  .enum(['pending', 'committed', 'failed'])
  .describe('Upload state of the artifact version.')
  .openapi('ArtifactVersionStatus');

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactVersionStatus = z.infer<typeof ArtifactVersionStatusSchema>;
