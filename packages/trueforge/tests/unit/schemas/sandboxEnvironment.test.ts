import configuration from '../../../src/config';
import {
  CreateSandboxEnvironmentRequestSchema,
  SandboxEnvironmentImageSchema,
  UpdateSandboxEnvironmentRequestSchema,
} from '../../../src/schemas/sandboxEnvironment';

describe('sandbox environment build script limits', () => {
  const requestWithBuildScript = (build_script: string) => ({
    manifest: {
      name: 'test-environment',
      image: { type: 'build' as const, build_script },
    },
  });

  it('defaults the API limit to 20000 characters without constraining the image schema', () => {
    expect(configuration.SANDBOX_ENVIRONMENT_BUILD_SCRIPT_MAX_LENGTH).toBe(20_000);

    const overLimitScript = 'x'.repeat(configuration.SANDBOX_ENVIRONMENT_BUILD_SCRIPT_MAX_LENGTH + 1);
    expect(SandboxEnvironmentImageSchema.safeParse({ type: 'build', build_script: overLimitScript }).success).toBe(
      true,
    );
  });

  it('enforces the configured limit on create and update requests', () => {
    const atLimit = requestWithBuildScript('x'.repeat(configuration.SANDBOX_ENVIRONMENT_BUILD_SCRIPT_MAX_LENGTH));
    expect(CreateSandboxEnvironmentRequestSchema.safeParse(atLimit).success).toBe(true);
    expect(UpdateSandboxEnvironmentRequestSchema.safeParse(atLimit).success).toBe(true);

    const overLimit = requestWithBuildScript('x'.repeat(configuration.SANDBOX_ENVIRONMENT_BUILD_SCRIPT_MAX_LENGTH + 1));
    const createResult = CreateSandboxEnvironmentRequestSchema.safeParse(overLimit);
    const updateResult = UpdateSandboxEnvironmentRequestSchema.safeParse(overLimit);

    expect(createResult.success).toBe(false);
    expect(updateResult.success).toBe(false);
    if (!createResult.success && !updateResult.success) {
      expect(createResult.error.issues[0]?.path).toEqual(['manifest', 'image', 'build_script']);
      expect(updateResult.error.issues[0]?.path).toEqual(['manifest', 'image', 'build_script']);
    }
  });
});
