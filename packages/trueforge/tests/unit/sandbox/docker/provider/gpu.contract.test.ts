import { createLogger } from 'winston';
import { DockerSandboxProvider } from '../../../../../src/sandbox/docker/provider/DockerSandboxProvider';

/**
 * Proves `gpus` actually reaches the device, by compiling and running a kernel and
 * checking the bandwidth it reports, rather than trusting that `--gpus` was passed.
 *
 * Skipped unless a GPU host is present, so it is safe in CI.
 */

const IMAGE = process.env['TFY_DOCKER_SANDBOX_GPU_IMAGE'] ?? 'nvidia/cuda:13.0.0-devel-ubuntu24.04';
const GPUS = process.env['TFY_DOCKER_SANDBOX_GPUS'] ?? 'all';

/** float4 device-to-device copy: the simplest kernel that saturates memory. */
const BANDWIDTH_KERNEL = String.raw`
#include <cstdio>
#include <cuda_runtime.h>
__global__ void copyk(const float4* __restrict__ in, float4* __restrict__ out, size_t n4) {
  size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x;
  if (i < n4) out[i] = in[i];
}
int main() {
  size_t bytes = 256ull << 20;
  size_t n4 = bytes / sizeof(float4);
  float4 *d_in, *d_out;
  if (cudaMalloc(&d_in, bytes) != cudaSuccess) { printf("ALLOC_FAIL\n"); return 1; }
  if (cudaMalloc(&d_out, bytes) != cudaSuccess) { printf("ALLOC_FAIL\n"); return 1; }
  cudaMemset(d_in, 1, bytes);
  int block = 256;
  size_t grid = (n4 + block - 1) / block;
  for (int i = 0; i < 3; i++) copyk<<<grid, block>>>(d_in, d_out, n4);
  cudaDeviceSynchronize();
  cudaEvent_t a, b;
  cudaEventCreate(&a); cudaEventCreate(&b);
  int iters = 30;
  cudaEventRecord(a);
  for (int i = 0; i < iters; i++) copyk<<<grid, block>>>(d_in, d_out, n4);
  cudaEventRecord(b);
  cudaEventSynchronize(b);
  float ms = 0;
  cudaEventElapsedTime(&ms, a, b);
  double gbps = (2.0 * bytes) / (ms / 1000.0 / iters) / 1e9;
  int mclk = 0, bus = 0;
  cudaDeviceGetAttribute(&mclk, cudaDevAttrMemoryClockRate, 0);
  cudaDeviceGetAttribute(&bus, cudaDevAttrGlobalMemoryBusWidth, 0);
  double peak = 2.0 * (double)mclk * 1e3 * (bus / 8.0) / 1e9;
  printf("ACHIEVED_GBPS=%.1f\nPEAK_GBPS=%.1f\nPCT_SOL=%.1f\nSTATUS=%s\n",
         gbps, peak, 100.0 * gbps / peak, cudaGetErrorString(cudaGetLastError()));
  return 0;
}
`;

describe('DockerSandboxProvider GPU', () => {
  let provider: DockerSandboxProvider | undefined;
  let sandboxId: string | undefined;
  let available = false;

  beforeAll(async () => {
    const support = await DockerSandboxProvider.isSupported();
    if (!support.supported) {
      return;
    }
    const candidate = new DockerSandboxProvider({
      image: IMAGE,
      gpus: GPUS,
      logger: createLogger({ silent: true }),
      execTimeoutSeconds: 300,
    });
    const build = await candidate.getImageBuildStatus();
    if (build.status !== 'ready') {
      return;
    }
    try {
      const created = await candidate.createSandbox();
      sandboxId = created.sandboxId;
      provider = candidate;
      available = true;
    } catch {
      await candidate.dispose();
    }
  }, 600_000);

  afterAll(async () => {
    await provider?.dispose();
  }, 120_000);

  it('exposes the GPU to nvidia-smi inside the sandbox', async () => {
    if (!available || !provider || !sandboxId) {
      pending('no GPU-capable docker host');
      return;
    }
    const result = await provider.exec({
      sandboxId,
      command: 'nvidia-smi --query-gpu=name --format=csv,noheader',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('unreachable');
    }
    expect(result.response.exitCode).toBe(0);
    expect(result.response.result).toMatch(/NVIDIA/);
  }, 120_000);

  it('compiles and runs a CUDA kernel at plausible bandwidth', async () => {
    if (!available || !provider || !sandboxId) {
      pending('no GPU-capable docker host');
      return;
    }
    // Upload rather than heredoc the source: this is the path a real kernel
    // project takes, and it exercises uploadFile with non-trivial content.
    await provider.uploadFile({
      sandboxId,
      remotePath: 'bw.cu',
      content: Buffer.from(BANDWIDTH_KERNEL, 'utf8'),
    });

    const arch = process.env['TFY_DOCKER_SANDBOX_GPU_ARCH'] ?? 'sm_89';
    const built = await provider.exec({
      sandboxId,
      command: `nvcc -O3 -arch=${arch} bw.cu -o bw`,
      timeoutSeconds: 300,
    });
    expect(built.success).toBe(true);
    if (!built.success) {
      throw new Error('unreachable');
    }
    expect(built.response.exitCode).toBe(0);

    const ran = await provider.exec({ sandboxId, command: './bw', timeoutSeconds: 300 });
    expect(ran.success).toBe(true);
    if (!ran.success) {
      throw new Error('unreachable');
    }
    expect(ran.response.exitCode).toBe(0);

    const out = ran.response.result;
    // Printed on purpose. This project's thesis is that a performance claim you
    // cannot see is a performance claim you cannot trust; that applies to its own
    // test suite too.
    // eslint-disable-next-line no-console
    console.log(`[gpu.smoke] nvcc -arch=${arch}\n${out.trim()}`);
    expect(out).toContain('STATUS=no error');

    const pct = Number(/PCT_SOL=([\d.]+)/.exec(out)?.[1]);
    expect(Number.isFinite(pct)).toBe(true);
    // Above 100% of theoretical peak means the measurement is wrong, which is
    // the whole premise of the roofline gate. Below 40% means the GPU is being
    // emulated or throttled hard enough that the sandbox is not usable for
    // benchmarking.
    expect(pct).toBeGreaterThan(40);
    expect(pct).toBeLessThanOrEqual(100);
  }, 600_000);

  it('round-trips a payload larger than the argv limit', async () => {
    if (!available || !provider || !sandboxId) {
      pending('no GPU-capable docker host');
      return;
    }
    // Regression guard for the failure mode in upstream issue #416: providers
    // that base64 the payload into a single argv die past roughly 96 KiB on
    // MAX_ARG_STRLEN / E2BIG. 5 MiB of non-repeating bytes is well past that and
    // also defeats any accidental compression.
    const size = 5 * 1024 * 1024;
    const payload = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      payload[i] = (i * 31 + (i >> 8)) & 0xff;
    }

    await provider.uploadFile({ sandboxId, remotePath: 'big.bin', content: payload });
    const downloaded = await provider.downloadFile({ sandboxId, path: 'big.bin' });

    expect(downloaded.length).toBe(size);
    expect(Buffer.compare(downloaded, payload)).toBe(0);
  }, 300_000);
});
