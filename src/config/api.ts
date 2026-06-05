const runtimeEnv = (
  globalThis as {
    process?: {env?: Record<string, string | undefined>};
  }
).process?.env;

export const COMPLIANCE_API_URL = runtimeEnv?.COMPLIANCE_API_URL ?? '';

export function complianceEndpoint(path: string): string {
  const baseUrl = COMPLIANCE_API_URL.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('COMPLIANCE_API_URL_NOT_CONFIGURED');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
