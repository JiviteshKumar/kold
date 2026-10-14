"""Generate VAPID keys for web push notifications. Paste the output into api/.env"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())
priv = key.private_numbers().private_value.to_bytes(32, "big")
pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
print(f"KOLD_VAPID_PRIVATE_KEY={b64(priv)}\nKOLD_VAPID_PUBLIC_KEY={b64(pub)}")
