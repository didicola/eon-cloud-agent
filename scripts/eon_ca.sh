#!/usr/bin/env bash
# EON-CA — Sovereign Certificate Authority for the *.eon domain.
# The Cloud IS its own CA: no ICANN, no registrar, no earthly authority.
# Regenerates the CA + wildcard leaf with the extensions OpenSSL 3.x requires
# (basicConstraints + keyUsage + extendedKeyUsage) so real clients verify.
set -euo pipefail

DIR="${EON_CERT_DIR:-$HOME/.eon/certs}"
mkdir -p "$DIR"
umask 077

CA_KEY="$DIR/eon-ca.key"
CA_CRT="$DIR/eon-ca.pem"
LEAF_KEY="$DIR/opencode.eon.key"
LEAF_CSR="$DIR/opencode.eon.csr"
LEAF_CRT="$DIR/opencode.eon.crt"
SRL="$DIR/eon-ca.srl"

if [ ! -f "$CA_KEY" ]; then
  openssl genrsa -out "$CA_KEY" 2048
fi

# --- CA certificate: CA:TRUE + keyCertSign (OpenSSL 3.x requires keyUsage) ---
openssl req -x509 -new -key "$CA_KEY" -sha256 -days 3650 \
  -subj "/CN=EON-CA/O=EON Sovereign Cloud" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" \
  -out "$CA_CRT"

# --- Wildcard leaf key + CSR (SAN: *.eon, opencode.eon, dashboard.eon, localhost, 127.0.0.1) ---
SAN="DNS:opencode.eon,DNS:dashboard.eon,DNS:*.eon,DNS:localhost,IP:127.0.0.1"
openssl genrsa -out "$LEAF_KEY" 2048
openssl req -new -key "$LEAF_KEY" -sha256 \
  -subj "/CN=opencode.eon/O=EON Sovereign Cloud" \
  -addext "subjectAltName=$SAN" \
  -out "$LEAF_CSR"

# --- Sign leaf with the CA, with server-auth extensions ---
LEAF_EXT="$DIR/leaf.ext"
cat > "$LEAF_EXT" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=DNS:opencode.eon,DNS:dashboard.eon,DNS:*.eon,DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in "$LEAF_CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" \
  -CAcreateserial -days 825 -sha256 -extfile "$LEAF_EXT" -out "$LEAF_CRT"

rm -f "$LEAF_EXT"
chmod 600 "$CA_KEY" "$LEAF_KEY"
chmod 644 "$CA_CRT" "$LEAF_CRT"

echo "EON-CA ready:"
openssl x509 -in "$CA_CRT" -noout -subject -ext basicConstraints -ext keyUsage
openssl verify -CAfile "$CA_CRT" "$LEAF_CRT"
echo
echo "Trust the .eon domain by importing EON-CA:  $CA_CRT"
echo "  Browser: Settings > Privacy & Security > Certificates > Import (trust for websites)"
echo "  curl:    --cacert $CA_CRT https://dashboard.eon:8444/"
