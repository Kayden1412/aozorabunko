/* Minimal CBOR decoder for the subset produced by build.py. */
function decodeCbor(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");

  function read() {
    const first = view.getUint8(pos++);
    const major = first >> 5;
    const info = first & 31;
    let value;
    if (info < 24) value = info;
    else if (info === 24) value = view.getUint8(pos++);
    else if (info === 25) { value = view.getUint16(pos); pos += 2; }
    else if (info === 26) { value = view.getUint32(pos); pos += 4; }
    else if (info === 27) {
      const hi = view.getUint32(pos);
      const lo = view.getUint32(pos + 4);
      pos += 8;
      value = hi * 4294967296 + lo;
    } else {
      throw new Error("Unsupported CBOR length");
    }

    switch (major) {
      case 0: return value;
      case 1: return -1 - value;
      case 2: {
        const out = bytes.subarray(pos, pos + value);
        pos += value;
        return out;
      }
      case 3: {
        const out = decoder.decode(bytes.subarray(pos, pos + value));
        pos += value;
        return out;
      }
      case 4: {
        const out = [];
        for (let i = 0; i < value; i++) out.push(read());
        return out;
      }
      case 5: {
        const out = {};
        for (let i = 0; i < value; i++) {
          const key = read();
          out[key] = read();
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error("Unsupported CBOR simple value");
      default:
        throw new Error("Unsupported CBOR type");
    }
  }

  return read();
}

/* Fetch one gzipped CBOR shard. The host may or may not add Content-Encoding. */
async function fetchCborShard(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (response.headers.get("content-encoding") !== "gzip") {
    if (!("DecompressionStream" in window)) {
      throw new Error("DecompressionStream is not supported");
    }
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return decodeCbor(bytes);
}
