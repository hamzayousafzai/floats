import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Unsafe URL: ${reason}`);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// [network, prefix length]
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // unspecified / "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

/** Expands an IPv6 literal into eight 16-bit groups. Returns null if it is not valid IPv6. */
function expandV6(ip: string): number[] | null {
  let text = ip.split("%")[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const v = ipv4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${((v >>> 16) & 0xffff).toString(16)}:${(v & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

function embeddedV4(high: number, low: number): string {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparseable: treat as unsafe
  const allZeroPrefix = g.slice(0, 5).every((x) => x === 0);
  if (allZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if (allZeroPrefix && g[5] === 0xffff) return isBlockedV4(embeddedV4(g[6], g[7])); // IPv4-mapped
  if (allZeroPrefix && g[5] === 0) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local (includes fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for loopback, private, link-local, multicast, reserved, unspecified and metadata addresses. */
export function isPrivateIp(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family === 4) return isBlockedV4(bare);
  if (family === 6) return isBlockedV6(bare);
  return true;
}

/**
 * Validates the syntactic parts of a URL before any network activity: HTTP(S) only, no embedded
 * credentials, no internal hostnames and no private IP literals. Returns the parsed URL.
 */
export function validatePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("only http and https are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("embedded credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new UnsafeUrlError("missing host");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError("internal hostname");
  if (isIP(host) !== 0 && isPrivateIp(host)) throw new UnsafeUrlError("private or reserved address");
  if (isIP(host) === 0 && !host.includes(".")) throw new UnsafeUrlError("single-label hostname");
  return url;
}

/** Every address a hostname resolves to must be public; a mixed answer is rejected as a rebinding risk. */
export function assertPublicAddresses(addresses: readonly string[]): void {
  if (addresses.length === 0) throw new UnsafeUrlError("hostname did not resolve");
  for (const address of addresses) {
    if (isPrivateIp(address)) throw new UnsafeUrlError("hostname resolves to a private or reserved address");
  }
}
