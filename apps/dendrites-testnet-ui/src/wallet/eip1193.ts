import type { Connector } from "wagmi";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

export async function resolveEip1193Provider(
  connector?: Connector | null
): Promise<Eip1193Provider | null> {
  const injected = (window as any)?.ethereum;
  if (injected?.request) return injected as Eip1193Provider;
  if (!connector) return null;
  try {
    const provider = await connector.getProvider();
    if ((provider as any)?.request) return provider as Eip1193Provider;
  } catch {
    // ignore connector errors
  }
  return null;
}

export function hasEip1193Provider(connector?: Connector | null) {
  return Boolean((window as any)?.ethereum) || Boolean(connector);
}
