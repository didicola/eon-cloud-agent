#!/usr/bin/env python3
"""
string_compact.py — String Compactification (Steganography).

Pure-stdlib PNG writer/reader (zlib + struct, no PIL). A 1024x1024 8-bit RGB
image of seeded noise is generated, and the payload bytes (with a 4-byte
big-endian length prefix) are folded into the LSBs of the R/G/B channels. The
result is a valid PNG whose pixel noise carries the JSON.

    python3 string_compact.py --test    # round-trip self-test -> PASS

Golden rule: stdlib only — zlib, struct, random, json. No PIL/numpy/torch.
"""
import json
import random
import struct
import sys
import zlib

WIDTH = HEIGHT = 1024
SIZE = WIDTH * HEIGHT * 3          # 3,145,728 bytes of RGB
_SIG = b"\x89PNG\r\n\x1a\n"


# ---- minimal PNG encoder / decoder (filter 0 scanlines, 8-bit RGB) --------
def _chunk(typ, data):
    return (struct.pack(">I", len(data)) + typ + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))


def _png_bytes(rgb):
    ihdr = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    raw = bytearray()
    stride = WIDTH * 3
    for y in range(HEIGHT):
        raw.append(0)                                   # filter byte 0
        raw += rgb[y * stride:(y + 1) * stride]
    idat = zlib.compress(bytes(raw), 9)
    return _SIG + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _read_rgb(data):
    if data[:8] != _SIG:
        raise ValueError("not a PNG (bad signature)")
    pos, idat, w, h = 8, b"", None, None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, _bd, _ct, _c, _f, _i = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = w * 3
    out = bytearray()
    off = 0
    for _ in range(h):
        f = raw[off]
        off += 1
        if f != 0:
            raise ValueError("unsupported filter %d" % f)
        out += raw[off:off + stride]
        off += stride
    return bytes(out), w, h


# ---- LSB embedding ---------------------------------------------------------
def _bits(data_bytes):
    out = []
    for byte in data_bytes:
        for sh in range(7, -1, -1):
            out.append((byte >> sh) & 1)
    return out


def _from_bits(bits):
    out = bytearray()
    for i in range(0, len(bits) - 7, 8):
        b = 0
        for bit in bits[i:i + 8]:
            b = (b << 1) | bit
        out.append(b)
    return bytes(out)


def _encode_bytes(data_bytes, path):
    framed = struct.pack(">I", len(data_bytes)) + data_bytes
    bits = _bits(framed)
    if len(bits) > SIZE:
        raise ValueError("payload too large for 1024x1024 LSB plane")
    rng = random.Random(zlib.crc32(data_bytes))        # deterministic noise
    img = bytearray(rng.getrandbits(8) for _ in range(SIZE))
    for i, b in enumerate(bits):
        img[i] = (img[i] & 0xFE) | b
    with open(path, "wb") as f:
        f.write(_png_bytes(bytes(img)))
    return path


def _decode_bytes(path):
    with open(path, "rb") as f:
        data = f.read()
    rgb, w, h = _read_rgb(data)
    if (w, h) != (WIDTH, HEIGHT):
        raise ValueError("unexpected dimensions %dx%d" % (w, h))
    bits = [rgb[i] & 1 for i in range(SIZE)]
    length = struct.unpack(">I", _from_bits(bits[:32]))[0]
    if length * 8 > SIZE - 32:
        raise ValueError("bad length prefix %d" % length)
    return _from_bits(bits[32:32 + length * 8])


# ---- public API ------------------------------------------------------------
def encode(json_payload, path="/tmp/compact.png"):
    """Embed a JSON dict into a valid noise PNG; return the file path."""
    return _encode_bytes(json.dumps(json_payload, separators=(",", ":")).encode(), path)


def decode(path):
    """Read a compactified PNG and return the original JSON dict."""
    return json.loads(_decode_bytes(path).decode())


def encode_str(s, path="/tmp/compact_str.png"):
    """Embed a raw string (length-prefixed); return the file path."""
    return _encode_bytes(s.encode(), path)


def decode_str(path):
    """Read a compactified PNG and return the original string."""
    return _decode_bytes(path).decode()


def _argval(name, dflt):
    if name not in sys.argv:
        return dflt
    i = sys.argv.index(name)
    return sys.argv[i + 1] if i + 1 < len(sys.argv) else dflt


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    if "--test" in args:
        obj = {"msg": "eon-string-compact", "i": 42}
        p = encode(obj)
        got = decode(p)
        s = "eon-string-compact"
        sp = encode_str(s)
        sg = decode_str(sp)
        ok = got == obj and sg == s
        print("PASS" if ok else "FAIL",
              json.dumps({"roundtrip": ok, "path": p, "decoded": got}))
        return 0 if ok else 1
    if "--encode" in args:
        payload = json.loads(_argval("--encode", '{"msg":"eon-string-compact"}'))
        path = _argval("--out", "/tmp/compact.png")
        encode(payload, path)
        print(json.dumps({"status": "encoded", "path": path, "payload": payload}))
        return 0
    if "--decode" in args:
        path = _argval("--path", "/tmp/compact.png")
        got = decode(path)
        print(json.dumps({"status": "decoded", "path": path, "payload": got}))
        return 0
    print("usage: python3 string_compact.py --test | --encode '<json>' --out <path> | --decode --path <path>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
