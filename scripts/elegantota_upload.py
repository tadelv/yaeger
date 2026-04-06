"""
PlatformIO custom upload command for ElegantOTA (web OTA).

Usage in platformio.ini:
  upload_protocol = custom
  custom_upload_url = http://yaeger.local/update
  extra_scripts = post:scripts/elegantota_upload.py
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

Import("env")


def _multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"----pio-elegantota-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for key, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )

    for key, (filename, data, content_type) in files.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{key}"; '
                    f'filename="{filename}"\r\n'
                ).encode(),
                f"Content-Type: {content_type}\r\n\r\n".encode(),
                data,
                b"\r\n",
            ]
        )

    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    return body, boundary


def _http_get(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url=url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read()


def _http_post(url: str, body: bytes, content_type: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url=url, method="POST", data=body)
    req.add_header("Content-Type", content_type)
    req.add_header("Content-Length", str(len(body)))
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.status, response.read()


def _normalise_base_url(custom_upload_url: str) -> str:
    parsed = urllib.parse.urlparse(custom_upload_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"custom_upload_url must start with http:// or https://, got: {custom_upload_url}")

    path = parsed.path or ""
    if path.endswith("/update"):
        path = path[: -len("/update")]

    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")).rstrip("/")


def on_upload(source, target, env):  # noqa: ANN001 (PlatformIO callback signature)
    firmware_path = str(source[0])
    custom_upload_url = env.GetProjectOption("custom_upload_url")
    base_url = _normalise_base_url(custom_upload_url)

    with open(firmware_path, "rb") as firmware_file:
        firmware_data = firmware_file.read()

    firmware_md5 = hashlib.md5(firmware_data).hexdigest()
    filename = os.path.basename(firmware_path)
    mode = "fs" if filename == "spiffs.bin" else "fr"

    start_url = f"{base_url}/ota/start?mode={mode}&hash={firmware_md5}"
    upload_url = f"{base_url}/ota/upload"

    print(f"ElegantOTA start: {start_url}")
    try:
        status, _ = _http_get(start_url)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to reach ElegantOTA start endpoint: {exc}") from exc

    if status != 200:
        raise RuntimeError(f"ElegantOTA start endpoint returned HTTP {status}")

    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    body, boundary = _multipart(
        fields={"MD5": firmware_md5},
        files={"firmware": (filename, firmware_data, content_type)},
    )

    print(f"ElegantOTA upload: {upload_url}")
    try:
        status, response = _http_post(upload_url, body, f"multipart/form-data; boundary={boundary}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to upload to ElegantOTA endpoint: {exc}") from exc

    if status != 200:
        raise RuntimeError(f"ElegantOTA upload failed with HTTP {status}: {response.decode(errors='ignore')}")

    print("ElegantOTA upload successful.")
    return 0


env.Replace(UPLOADCMD=on_upload)
