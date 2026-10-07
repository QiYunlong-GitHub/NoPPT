import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface RemoteImageResult {
  ok: boolean;
  status: number;
  headers: Headers;
  buffer: Buffer;
}

export type RemoteImageFetcher = (
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
  isForbiddenHost: (hostname: string) => boolean,
) => Promise<RemoteImageResult>;

function headersFromNode(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  return headers;
}

function readNodeBody(
  response: IncomingMessage,
  maxBytes: number,
  request: ReturnType<typeof httpRequest>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };
    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        fail(new Error('Downloaded image exceeds the size limit'));
        return;
      }
      chunks.push(buffer);
    });
    response.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    response.on('error', fail);
  });
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export type RemoteAddressLookup = (hostname: string) => Promise<readonly PinnedAddress[]>;

export async function fetchPinnedRemoteImageWithLookup(
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
  isForbiddenHost: (hostname: string) => boolean,
  resolveHost: RemoteAddressLookup = async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map((entry) => ({
      address: entry.address,
      family: entry.family === 6 ? (6 as const) : (4 as const),
    }));
  },
): Promise<RemoteImageResult> {
  const addresses = await resolveHost(url.hostname);
  if (!addresses.length || addresses.some((entry) => isForbiddenHost(entry.address))) {
    throw new Error('Image URL destination is not allowed');
  }

  const pinned = addresses[0];
  const requestFn: typeof httpRequest =
    url.protocol === 'https:' ? (httpsRequest as typeof httpRequest) : httpRequest;
  const requestOptions = {
    protocol: url.protocol,
    hostname: pinned.address,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: {
      Accept: 'image/*',
      Host: url.host,
    },
    lookup: (
      _hostname: string,
      _options: unknown,
      callback: (error: Error | null, address: string, family: number) => void,
    ) => {
      callback(null, pinned.address, pinned.family);
    },
    ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
  };

  return new Promise<RemoteImageResult>((resolve, reject) => {
    const request = requestFn(requestOptions, (response) => {
      const headers = headersFromNode(response);
      const contentLength = Number(headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        response.resume();
        request.destroy();
        reject(new Error('Downloaded image exceeds the size limit'));
        return;
      }
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        resolve({ ok: false, status: response.statusCode, headers, buffer: Buffer.alloc(0) });
        return;
      }
      void readNodeBody(response, maxBytes, request)
        .then((buffer) =>
          resolve({
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
            status: response.statusCode ?? 500,
            headers,
            buffer,
          }),
        )
        .catch(reject);
    });
    const abort = () => request.destroy(new Error('Image fetch aborted'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    request.once('error', reject);
    request.end();
  });
}

export const fetchPinnedRemoteImage: RemoteImageFetcher = fetchPinnedRemoteImageWithLookup;
