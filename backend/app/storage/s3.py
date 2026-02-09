import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class S3Config:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    region: str
    use_ssl: bool


def get_s3_config() -> Optional[S3Config]:
    endpoint = (os.environ.get("S3_ENDPOINT_URL") or "").strip()
    access = (os.environ.get("S3_ACCESS_KEY_ID") or "").strip()
    secret = (os.environ.get("S3_SECRET_ACCESS_KEY") or "").strip()
    bucket = (os.environ.get("S3_BUCKET") or "").strip()
    region = (os.environ.get("S3_REGION") or "us-east-1").strip() or "us-east-1"
    use_ssl_raw = (os.environ.get("S3_USE_SSL") or "").strip().lower()
    use_ssl = use_ssl_raw not in {"0", "false", "no"}

    if not endpoint or not access or not secret or not bucket:
        return None
    return S3Config(
        endpoint_url=endpoint,
        access_key_id=access,
        secret_access_key=secret,
        bucket=bucket,
        region=region,
        use_ssl=use_ssl,
    )


def s3_enabled() -> bool:
    return get_s3_config() is not None


def _client():
    # Lazy import so local dev without boto3 installed still runs (falls back to db storage).
    import boto3
    from botocore.config import Config

    cfg = get_s3_config()
    if not cfg:
        raise RuntimeError("S3 not configured")

    # Force v4 signatures so MinIO works consistently.
    bc = Config(signature_version="s3v4", s3={"addressing_style": "path"})
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name=cfg.region,
        use_ssl=cfg.use_ssl,
        config=bc,
    )


def put_bytes(*, key: str, data: bytes, content_type: str) -> str:
    cfg = get_s3_config()
    if not cfg:
        raise RuntimeError("S3 not configured")
    c = _client()
    res = c.put_object(
        Bucket=cfg.bucket,
        Key=key,
        Body=data or b"",
        ContentType=content_type or "application/octet-stream",
    )
    etag = (res.get("ETag") or "").strip('"')  # ETag is often quoted.
    return etag


def presign_get(
    *,
    key: str,
    filename: str,
    content_type: str,
    disposition: str,
    expires_seconds: int = 300,
) -> str:
    """
    Create a short-lived, signed URL for viewing/downloading attachments.
    """
    cfg = get_s3_config()
    if not cfg:
        raise RuntimeError("S3 not configured")
    c = _client()

    disp = "inline"
    if (disposition or "").lower().startswith("attachment"):
        disp = "attachment"
    safe_name = (filename or "attachment").replace("\n", " ").replace("\r", " ").strip() or "attachment"
    cd = f'{disp}; filename="{safe_name}"'
    ct = (content_type or "application/octet-stream").strip() or "application/octet-stream"

    return c.generate_presigned_url(
        ClientMethod="get_object",
        Params={
            "Bucket": cfg.bucket,
            "Key": key,
            "ResponseContentDisposition": cd,
            "ResponseContentType": ct,
        },
        ExpiresIn=max(30, min(int(expires_seconds), 3600)),
    )

