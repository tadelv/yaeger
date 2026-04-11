"""
PlatformIO custom upload command for ElegantOTA (web OTA).

Supports HTTP Basic Auth via one of:
  - YAEGER_OTA_USERNAME / YAEGER_OTA_PASSWORD environment variables
  - Credentials embedded in custom_upload_url, e.g. http://user:pass@yaeger.local/update

Usage in platformio.ini:
  upload_protocol = custom
  custom_upload_url = http://yaeger.local/update
  extra_scripts = post:scripts/elegantota_upload.py
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import time
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


def _build_auth_header(username: str | None, password: str | None) -> str | None:
    if not username or password is None:
        return None

    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"




def _should_retry_http_error(code: int) -> bool:
    return code in (408, 425, 429, 500, 502, 503, 504)


def _with_backoff(request_fn, description: str, max_attempts: int = 5):
    delay_seconds = 0.5

    for attempt in range(1, max_attempts + 1):
        try:
            return request_fn()
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise
            if attempt == max_attempts or not _should_retry_http_error(exc.code):
                raise
            print(f"{description} HTTP {exc.code}; retrying in {delay_seconds:.1f}s (attempt {attempt}/{max_attempts})")
            time.sleep(delay_seconds)
            delay_seconds = min(delay_seconds * 2, 8.0)
        except urllib.error.URLError:
            if attempt == max_attempts:
                raise
            print(f"{description} network error; retrying in {delay_seconds:.1f}s (attempt {attempt}/{max_attempts})")
            time.sleep(delay_seconds)
            delay_seconds = min(delay_seconds * 2, 8.0)

    raise RuntimeError(f"{description} failed after retry limit")

def _http_get(url: str, auth_header: str | None) -> tuple[int, bytes]:
    req = urllib.request.Request(url=url, method="GET")
    if auth_header:
        req.add_header("Authorization", auth_header)
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read()


def _http_post(url: str, body: bytes, content_type: str, auth_header: str | None) -> tuple[int, bytes]:
    req = urllib.request.Request(url=url, method="POST", data=body)
    req.add_header("Content-Type", content_type)
    req.add_header("Content-Length", str(len(body)))
    if auth_header:
        req.add_header("Authorization", auth_header)
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.status, response.read()


def _normalise_base_url(custom_upload_url: str) -> tuple[str, str | None]:
    parsed = urllib.parse.urlparse(custom_upload_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"custom_upload_url must start with http:// or https://, got: {custom_upload_url}")

    path = parsed.path or ""
    if path.endswith("/update"):
        path = path[: -len("/update")]

    base_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")).rstrip("/")

    env_username = os.getenv("YAEGER_OTA_USERNAME")
    env_password = os.getenv("YAEGER_OTA_PASSWORD")

    url_username = urllib.parse.unquote(parsed.username) if parsed.username else None
    url_password = urllib.parse.unquote(parsed.password) if parsed.password else None

    username = env_username or url_username or "admin"
    password = env_password if env_password is not None else url_password

    # Remove credentials from URL that will be used in requests
    if "@" in base_url:
        sanitized_netloc = parsed.hostname or ""
        if parsed.port:
            sanitized_netloc = f"{sanitized_netloc}:{parsed.port}"
        base_url = urllib.parse.urlunparse((parsed.scheme, sanitized_netloc, path, "", "", "")).rstrip("/")

    return base_url, _build_auth_header(username, password)

def _detect_ota_mode(env, filename: str) -> str:  # noqa: ANN001 (PlatformIO callback data)
    get_value = getattr(env, "get", None)
    raw_targets = get_value("COMMAND_LINE_TARGETS") if callable(get_value) else None
    target_names = set(raw_targets or [])
    if "uploadfs" in target_names or "buildfs" in target_names:
        return "fs"

    lowered = filename.lower()
    if "littlefs" in lowered or "spiffs" in lowered or "fatfs" in lowered:
        return "fs"

    return "fr"


def on_upload(source, target, env):  # noqa: ANN001 (PlatformIO callback signature)
    firmware_path = str(source[0])
    custom_upload_url = env.GetProjectOption("custom_upload_url")
    base_url, auth_header = _normalise_base_url(custom_upload_url)

    with open(firmware_path, "rb") as firmware_file:
        firmware_data = firmware_file.read()

    firmware_md5 = hashlib.md5(firmware_data).hexdigest()
    filename = os.path.basename(firmware_path)
    mode = _detect_ota_mode(env, filename)

    start_url = f"{base_url}/ota/start?mode={mode}&hash={firmware_md5}"
    upload_url = f"{base_url}/ota/upload"

    print(f"ElegantOTA start: {start_url}")
    try:
        status, _ = _with_backoff(lambda: _http_get(start_url, auth_header), "ElegantOTA start")
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise RuntimeError(
                "ElegantOTA requires authentication. Set YAEGER_OTA_PASSWORD "
                "(and optional YAEGER_OTA_USERNAME) before running PlatformIO upload."
            ) from exc
        raise RuntimeError(f"Failed to reach ElegantOTA start endpoint: {exc}") from exc
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
        status, response = _with_backoff(
            lambda: _http_post(upload_url, body, f"multipart/form-data; boundary={boundary}", auth_header),
            "ElegantOTA upload",
        )
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise RuntimeError(
                "ElegantOTA upload unauthorized. Verify YAEGER_OTA_PASSWORD "
                "matches the device admin password."
            ) from exc
        raise RuntimeError(f"Failed to upload to ElegantOTA endpoint: {exc}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to upload to ElegantOTA endpoint: {exc}") from exc

    if status != 200:
        raise RuntimeError(f"ElegantOTA upload failed with HTTP {status}: {response.decode(errors='ignore')}")

    print("ElegantOTA upload successful.")
    return 0


env.Replace(UPLOADCMD=on_upload)
