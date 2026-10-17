"""Generate a VAPID key pair. Usage: python scripts/generate_vapid.py"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
priv = key.private_numbers().private_value.to_bytes(32, "big")
pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
print("VAPID_PRIVATE_KEY=" + b64(priv))
print("VAPID_PUBLIC_KEY=" + b64(pub))
print("VAPID_SUBJECT=mailto:you@example.com")
print("# Frontend: VITE_VAPID_PUBLIC_KEY=<same as VAPID_PUBLIC_KEY>")
