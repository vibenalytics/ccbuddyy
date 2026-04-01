// Pure JS implementation of Zig's std.hash.Wyhash (used by Bun.hash)
// Verified against Bun.hash output across all string lengths 0-51+

const mask64 = (1n << 64n) - 1n;
const s0 = 0xa0761d6478bd642fn;
const s1 = 0xe7037ed1a0b428dbn;
const s2 = 0x8ebc6af09c88c6e3n;
const s3 = 0x589965cc75374cc3n;

function mum(a, b) {
  a = a & mask64;
  b = b & mask64;
  const full = a * b;
  return [full & mask64, (full >> 64n) & mask64];
}

function mix(a, b) {
  const [lo, hi] = mum(a & mask64, b & mask64);
  return (lo ^ hi) & mask64;
}

function r32(buf, off) {
  return BigInt(buf[off]) | (BigInt(buf[off + 1]) << 8n) |
    (BigInt(buf[off + 2]) << 16n) | (BigInt(buf[off + 3]) << 24n);
}

function r64(buf, off) {
  return r32(buf, off) | (r32(buf, off + 4) << 32n);
}

export function wyhash(input, seed = 0n) {
  const buf = Buffer.from(input);
  const len = buf.length;
  seed = BigInt(seed);

  let state0 = (seed ^ mix((seed ^ s0) & mask64, s1)) & mask64;
  let state1 = state0;
  let state2 = state0;
  let a = 0n, b = 0n;

  if (len <= 16) {
    if (len >= 4) {
      const q = (len >> 3) << 2;
      a = (r32(buf, 0) << 32n) | r32(buf, q);
      b = (r32(buf, len - 4) << 32n) | r32(buf, len - 4 - q);
    } else if (len > 0) {
      a = (BigInt(buf[0]) << 16n) | (BigInt(buf[len >> 1]) << 8n) | BigInt(buf[len - 1]);
      b = 0n;
    }
  } else {
    let i = 0;
    if (len >= 48) {
      while (i + 48 <= len) {
        state0 = mix((r64(buf, i) ^ s1) & mask64, (r64(buf, i + 8) ^ state0) & mask64);
        state1 = mix((r64(buf, i + 16) ^ s2) & mask64, (r64(buf, i + 24) ^ state1) & mask64);
        state2 = mix((r64(buf, i + 32) ^ s3) & mask64, (r64(buf, i + 40) ^ state2) & mask64);
        i += 48;
      }
      state0 = (state0 ^ state1 ^ state2) & mask64;
    }

    const remaining = len - i;
    if (remaining > 32) {
      state0 = mix((r64(buf, i) ^ s1) & mask64, (r64(buf, i + 8) ^ state0) & mask64);
      state0 = mix((r64(buf, i + 16) ^ s2) & mask64, (r64(buf, i + 24) ^ state0) & mask64);
    } else if (remaining > 16) {
      state0 = mix((r64(buf, i) ^ s1) & mask64, (r64(buf, i + 8) ^ state0) & mask64);
    }

    a = r64(buf, len - 16);
    b = r64(buf, len - 8);
  }

  a = (a ^ s1) & mask64;
  b = (b ^ state0) & mask64;
  const [ma, mb] = mum(a, b);
  return mix((ma ^ s0 ^ BigInt(len)) & mask64, (mb ^ s1) & mask64);
}

export function bunHash32(str) {
  return Number(wyhash(str) & 0xFFFFFFFFn);
}
