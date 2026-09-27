import { Packr } from 'msgpackr';

// Plain maps (no record extension) so any msgpack decoder can read the frames.
const packr = new Packr({ useRecords: false, mapsAsObjects: true });

export function encode(msg: unknown): Buffer {
  return packr.pack(msg);
}

export function decode(data: Buffer | ArrayBuffer | Buffer[]): unknown {
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
  return packr.unpack(buf);
}
