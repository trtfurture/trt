from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import tempfile
import json
import uuid
import time
import threading
import mimetypes
import sqlite3
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse, urlunparse
import ipaddress

import requests

from flask import (
    Flask, jsonify, make_response, redirect,
    render_template, request, send_file, send_from_directory, session, url_for,
)
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = Path(__file__).resolve().parent
MAX_EXPORT_BYTES = 1_500 * 1024 * 1024  # 1.5 GB; browser exports are streamed to disk.
MAX_AI_WORKFLOW_BYTES = 4 * 1024 * 1024
MAX_AI_IMAGE_BYTES = 40 * 1024 * 1024
AI_JOB_TTL_SECONDS = 6 * 60 * 60
AI_JOBS: dict[str, dict] = {}
AI_JOBS_LOCK = threading.Lock()
AI_JOB_DB_PATH = BASE_DIR / "instance" / "pea-ai-jobs.sqlite3"

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_EXPORT_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    TEMPLATES_AUTO_RELOAD=False,
)


def credentials() -> tuple[str, str]:
    """Read the only application credentials from the two Render variables."""
    name = os.environ.get("ADMIN_NAME", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    return name, password


def configured() -> bool:
    name, password = credentials()
    return bool(name and password)


def ensure_secret_key() -> None:
    # No third secret variable is required. Rotating ADMIN_PASSWORD also rotates
    # the signing key and invalidates existing sessions.
    name, password = credentials()
    if name and password:
        material = f"{name}\u0000{password}".encode("utf-8")
        app.secret_key = hashlib.pbkdf2_hmac("sha256", material, b"PEA-STUDIO-SESSION-v1", 350_000, dklen=32)
    else:
        app.secret_key = secrets.token_bytes(32)


ensure_secret_key()


def is_authenticated() -> bool:
    return bool(session.get("pea_authenticated")) and configured()


def csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def csrf_ok() -> bool:
    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    return bool(supplied and expected and hmac.compare_digest(supplied, expected))


def login_required_json():
    if not is_authenticated():
        return jsonify(ok=False, error="Your studio session has expired. Sign in again."), 401
    return None


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "
        "style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
    if request.path in {"/", "/login", "/studio"} or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/healthz")
def healthz():
    return jsonify(ok=True, ffmpeg=bool(shutil.which("ffmpeg")))


@app.get("/login")
def login_page():
    if not configured():
        return render_template("setup_error.html"), 503
    if is_authenticated():
        return redirect(url_for("home"))
    return render_template("login.html", csrf=csrf_token())


@app.post("/login")
def login():
    if not configured():
        return jsonify(ok=False, error="Set ADMIN_NAME and ADMIN_PASSWORD in your hosting environment."), 503
    if not csrf_ok():
        return jsonify(ok=False, error="The sign-in page expired. Refresh and try again."), 400
    expected_name, expected_password = credentials()
    entered_name = request.form.get("admin_name", "").strip()
    entered_password = request.form.get("admin_password", "")
    valid = (
        hmac.compare_digest(entered_name.encode("utf-8"), expected_name.encode("utf-8"))
        and hmac.compare_digest(entered_password.encode("utf-8"), expected_password.encode("utf-8"))
    )
    if not valid:
        return jsonify(ok=False, error="Those credentials do not match this private studio."), 401
    session.clear()
    session.permanent = True
    session["pea_authenticated"] = True
    session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify(ok=True, next=url_for("home"))


@app.post("/logout")
def logout():
    if not csrf_ok():
        return jsonify(ok=False, error="Security check failed. Refresh the page and try again."), 400
    session.clear()
    return jsonify(ok=True, next=url_for("login_page"))


@app.get("/")
def home():
    if not configured():
        return render_template("setup_error.html"), 503
    if not is_authenticated():
        return redirect(url_for("login_page"))
    return render_template("studio.html", csrf=csrf_token())


@app.get("/studio")
def studio_alias():
    return home()


@app.get("/api/session")
def api_session():
    if not is_authenticated():
        return jsonify(ok=False, authenticated=False), 401
    return jsonify(ok=True, authenticated=True, csrf=csrf_token(), admin_name=credentials()[0])


@app.get("/api/status")
def api_status():
    rejected = login_required_json()
    if rejected:
        return rejected
    return jsonify(ok=True, ffmpeg=bool(shutil.which("ffmpeg")), max_upload_bytes=MAX_EXPORT_BYTES)


@app.post("/api/export/mp4")
def export_mp4():
    rejected = login_required_json()
    if rejected:
        return rejected
    if not csrf_ok():
        return jsonify(ok=False, error="Security check failed. Reload the studio and try again."), 400
    upload = request.files.get("video")
    if upload is None or not upload.filename:
        return jsonify(ok=False, error="No finished video was received."), 400
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return jsonify(ok=False, error="FFmpeg is not installed on this server. Use the Dockerfile deployment or install FFmpeg locally."), 503

    work_dir = Path(tempfile.mkdtemp(prefix="pea-export-"))
    source = work_dir / "source.webm"
    output = work_dir / "pea-advert.mp4"
    try:
        upload.save(source)
        if source.stat().st_size == 0:
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error="The uploaded video was empty."), 400
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source),
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", "-shortest", str(output),
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=1800, check=False)
        except subprocess.TimeoutExpired:
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error="This export exceeded the server's 30-minute safety limit. Try a shorter or lower-resolution version."), 504
        if result.returncode != 0 or not output.exists() or output.stat().st_size == 0:
            detail = (result.stderr or "FFmpeg could not encode this video.").strip()[-1200:]
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error=f"MP4 conversion failed: {detail}"), 422
        response = send_file(
            output, mimetype="video/mp4", as_attachment=True,
            download_name="pea-advert.mp4", max_age=0,
        )
        response.headers["Cache-Control"] = "no-store"
        response.call_on_close(lambda: shutil.rmtree(work_dir, ignore_errors=True))
        return response
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise


# ---------------------------------------------------------------------------
# Local ComfyUI / LTX generation bridge
# ---------------------------------------------------------------------------
def _normalise_engine_url(raw: str) -> str:
    value = (raw or "http://127.0.0.1:8188").strip().rstrip("/")
    if len(value) > 500:
        raise ValueError("The AI engine address is too long.")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Enter a valid ComfyUI address, for example http://127.0.0.1:8188.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The AI engine address must not contain credentials, a query string or a fragment.")
    host = parsed.hostname.lower()
    local_host = host in {"localhost", "127.0.0.1", "::1"}
    private_ip = False
    try:
        private_ip = ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    # Plain HTTP is allowed only for loopback/LAN engines. A remote endpoint must
    # be HTTPS so media and prompts are not sent in clear text.
    if parsed.scheme == "http" and not (local_host or private_ip):
        raise ValueError("Remote AI engines must use HTTPS. Plain HTTP is allowed only for localhost or a private LAN address.")
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "", ""))


def _ai_auth_and_csrf_error():
    rejected = login_required_json()
    if rejected:
        return rejected
    if not csrf_ok():
        return jsonify(ok=False, error="Security check failed. Refresh PEA Studio and try again."), 400
    return None


def _engine_request(method: str, base_url: str, path: str, **kwargs):
    url = f"{base_url}{path}"
    timeout = kwargs.pop("timeout", (8, 30))
    try:
        response = requests.request(method, url, timeout=timeout, **kwargs)
    except requests.exceptions.Timeout as exc:
        raise RuntimeError("The AI engine took too long to respond. Check that ComfyUI is running and that its GPU is not busy.") from exc
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError("PEA cannot reach the AI engine. Start ComfyUI on this computer and check the engine address. If PEA is hosted on Render, 127.0.0.1 means Render itself—not your computer. Run PEA locally beside ComfyUI for private, no-cloud generation.") from exc
    except requests.RequestException as exc:
        raise RuntimeError(f"The AI engine connection failed: {exc.__class__.__name__}.") from exc
    if response.status_code >= 400:
        detail = ""
        try:
            payload = response.json()
            detail = payload.get("error") or payload.get("message") or payload.get("detail") or ""
            if not detail and payload.get("node_errors"):
                detail = json.dumps(payload.get("node_errors"), ensure_ascii=False)[:1200]
        except Exception:
            detail = response.text[:700]
        raise RuntimeError(f"ComfyUI returned HTTP {response.status_code}. {detail or 'Check the workflow and installed model nodes.'}")
    return response


def _workflow_for_api(raw: str) -> dict:
    if not raw or len(raw.encode("utf-8")) > MAX_AI_WORKFLOW_BYTES:
        raise ValueError("Choose a ComfyUI API workflow JSON file smaller than 4 MB.")
    try:
        workflow = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("That workflow file is not valid JSON.") from exc
    if not isinstance(workflow, dict) or not workflow:
        raise ValueError("The workflow is empty or has the wrong format.")
    # A standard ComfyUI canvas-save file has a top-level nodes array. The API
    # export is a dictionary keyed by numeric node IDs with class_type + inputs.
    if isinstance(workflow.get("nodes"), list):
        raise ValueError("This is the normal canvas workflow, not the API export. In ComfyUI choose File → Export Workflow (API), then upload that JSON here.")
    valid = 0
    for node_id, node in workflow.items():
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict) or not node.get("class_type"):
            continue
        valid += 1
    if not valid:
        raise ValueError("No API-format ComfyUI nodes were found. Export the workflow using File → Export Workflow (API).")
    return workflow


def _candidate_title(node: dict, node_id: str) -> str:
    meta = node.get("_meta") or {}
    title = meta.get("title") or node.get("class_type") or "Node"
    return f"{title} · node {node_id}"


def _workflow_candidates(workflow: dict) -> dict:
    prompts = []
    images = []
    for node_id, node in workflow.items():
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            continue
        node_type = str(node.get("class_type", ""))
        node_title = str((node.get("_meta") or {}).get("title", ""))
        combined = f"{node_type} {node_title}".lower()
        for input_name, value in node["inputs"].items():
            key = str(input_name).lower()
            if isinstance(value, str) and key in {"text", "prompt", "positive_prompt", "positive"}:
                negative = "negative" in combined or "negative" in key or "uncond" in combined
                score = 0 if negative else 10
                if "positive" in combined or "positive" in key:
                    score += 8
                if "prompt" in combined:
                    score += 5
                if "text" in key:
                    score += 2
                prompts.append({
                    "node_id": str(node_id), "input": str(input_name),
                    "title": _candidate_title(node, str(node_id)),
                    "class_type": node_type, "score": score,
                    "negative": negative,
                })
            if isinstance(value, str) and key in {"image", "image_path", "start_image", "start_frame"}:
                if any(token in combined for token in ("loadimage", "load image", "image input", "start image", "reference image")):
                    images.append({
                        "node_id": str(node_id), "input": str(input_name),
                        "title": _candidate_title(node, str(node_id)),
                        "class_type": node_type,
                    })
    prompts.sort(key=lambda item: (item["score"], item["node_id"]), reverse=True)
    images.sort(key=lambda item: ("loadimage" in item["class_type"].lower(), item["node_id"]), reverse=True)
    return {"prompts": prompts, "images": images}


def _ai_db():
    AI_JOB_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AI_JOB_DB_PATH, timeout=15)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE IF NOT EXISTS ai_jobs (job_id TEXT PRIMARY KEY, created_at REAL NOT NULL, payload TEXT NOT NULL)")
    return connection


def _persist_ai_job(job: dict) -> None:
    """Persist job metadata locally so a PEA process restart does not lose the queue record."""
    try:
        with _ai_db() as connection:
            connection.execute(
                "INSERT INTO ai_jobs(job_id, created_at, payload) VALUES(?, ?, ?) "
                "ON CONFLICT(job_id) DO UPDATE SET created_at=excluded.created_at, payload=excluded.payload",
                (job["id"], float(job.get("created_at", time.time())), json.dumps(job, ensure_ascii=False)),
            )
    except sqlite3.Error:
        app.logger.exception("PEA could not persist AI job metadata")


def _store_ai_job(job: dict) -> None:
    snapshot = dict(job)
    with AI_JOBS_LOCK:
        AI_JOBS[snapshot["id"]] = snapshot
    _persist_ai_job(snapshot)


def _update_ai_job(job_id: str, **changes) -> dict | None:
    with AI_JOBS_LOCK:
        current = AI_JOBS.get(job_id)
        if not current:
            return None
        current.update(changes)
        snapshot = dict(current)
    _persist_ai_job(snapshot)
    return snapshot


def _load_ai_jobs() -> None:
    """Restore recent generations after a local PEA restart."""
    try:
        cutoff = time.time() - AI_JOB_TTL_SECONDS
        with _ai_db() as connection:
            connection.execute("DELETE FROM ai_jobs WHERE created_at < ?", (cutoff,))
            rows = connection.execute("SELECT payload FROM ai_jobs WHERE created_at >= ?", (cutoff,)).fetchall()
        restored = {}
        for (payload,) in rows:
            try:
                job = json.loads(payload)
                if isinstance(job, dict) and job.get("id"):
                    restored[str(job["id"])] = job
            except (TypeError, json.JSONDecodeError):
                continue
        with AI_JOBS_LOCK:
            AI_JOBS.update(restored)
    except sqlite3.Error:
        app.logger.exception("PEA could not restore previous AI job records")


def _prune_ai_jobs():
    cutoff = time.time() - AI_JOB_TTL_SECONDS
    expired = []
    with AI_JOBS_LOCK:
        for job_id in list(AI_JOBS):
            if AI_JOBS[job_id].get("created_at", 0) < cutoff:
                expired.append(job_id)
                AI_JOBS.pop(job_id, None)
    if expired:
        try:
            with _ai_db() as connection:
                connection.executemany("DELETE FROM ai_jobs WHERE job_id = ?", [(job_id,) for job_id in expired])
        except sqlite3.Error:
            app.logger.exception("PEA could not prune old AI job records")


def _extract_comfy_outputs(history_entry: dict) -> list[dict]:
    outputs = []
    node_outputs = history_entry.get("outputs") or {}
    for node_id, node_output in node_outputs.items():
        if not isinstance(node_output, dict):
            continue
        for key in ("videos", "gifs", "images", "audio"):
            for item in node_output.get(key) or []:
                if not isinstance(item, dict) or not item.get("filename"):
                    continue
                filename = Path(str(item["filename"])).name
                subfolder = str(item.get("subfolder") or "").strip("/")
                folder_type = str(item.get("type") or "output")
                ext = Path(filename).suffix.lower()
                if key == "videos" or key == "gifs" or ext in {".mp4", ".webm", ".mov", ".mkv", ".avi"}:
                    kind = "video"
                elif key == "audio" or ext in {".mp3", ".wav", ".m4a", ".ogg", ".flac"}:
                    kind = "audio"
                else:
                    kind = "image"
                outputs.append({
                    "node_id": str(node_id), "filename": filename,
                    "subfolder": subfolder, "type": folder_type,
                    "kind": kind, "mime_type": mimetypes.guess_type(filename)[0] or ("video/mp4" if kind == "video" else "application/octet-stream"),
                })
    # Keep videos first; do not lose an image output if a workflow only saves frames.
    outputs.sort(key=lambda item: (item["kind"] != "video", item["filename"].lower()))
    return outputs


_load_ai_jobs()


@app.post("/api/ai/status")
def ai_status():
    rejected = _ai_auth_and_csrf_error()
    if rejected:
        return rejected
    try:
        payload = request.get_json(silent=True) or {}
        base_url = _normalise_engine_url(payload.get("engine_url", "http://127.0.0.1:8188"))
        system = _engine_request("GET", base_url, "/system_stats", timeout=(5, 15)).json()
        queue_data = _engine_request("GET", base_url, "/queue", timeout=(5, 15)).json()
        devices = []
        for device in system.get("devices", []) if isinstance(system, dict) else []:
            devices.append({
                "name": device.get("name") or device.get("device") or "GPU",
                "type": device.get("type") or "",
                "vram_total": device.get("vram_total"),
                "vram_free": device.get("vram_free"),
            })
        queue_running = len(queue_data.get("queue_running", [])) if isinstance(queue_data, dict) else 0
        queue_pending = len(queue_data.get("queue_pending", [])) if isinstance(queue_data, dict) else 0
        return jsonify(ok=True, connected=True, engine="ComfyUI", devices=devices,
                       queue_running=queue_running, queue_pending=queue_pending,
                       message="Your AI engine is connected. PEA can submit jobs to its queue.")
    except (ValueError, RuntimeError, requests.RequestException) as exc:
        return jsonify(ok=False, connected=False, error=str(exc)), 503
    except Exception as exc:
        app.logger.exception("PEA AI status check failed")
        return jsonify(ok=False, connected=False, error=f"Could not verify the AI engine: {exc.__class__.__name__}."), 502


@app.post("/api/ai/inspect-workflow")
def ai_inspect_workflow():
    rejected = _ai_auth_and_csrf_error()
    if rejected:
        return rejected
    try:
        payload = request.get_json(silent=True) or {}
        workflow = _workflow_for_api(json.dumps(payload.get("workflow", {}), ensure_ascii=False))
        candidates = _workflow_candidates(workflow)
        if not candidates["prompts"]:
            return jsonify(ok=False, error="PEA could not find a text/prompt field in this workflow. Use an LTX text-to-video or image-to-video API workflow and inspect its prompt nodes."), 422
        if not candidates["images"]:
            # Text-to-video remains valid. The user may choose a no-image workflow.
            note = "This workflow appears to be text-to-video. Uploading a reference photo will not be used unless its API workflow includes a Load Image node."
        else:
            note = "Workflow recognised. PEA found editable prompt and image input nodes."
        return jsonify(ok=True, prompts=candidates["prompts"], images=candidates["images"], note=note,
                       node_count=len(workflow))
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.post("/api/ai/generate")
def ai_generate():
    rejected = _ai_auth_and_csrf_error()
    if rejected:
        return rejected
    try:
        engine_url = _normalise_engine_url(request.form.get("engine_url", "http://127.0.0.1:8188"))
        client_request_id = str(request.form.get("client_request_id", "")).strip()
        try:
            uuid.UUID(client_request_id)
        except (ValueError, AttributeError):
            return jsonify(ok=False, error="The generation request identifier is missing or invalid. Refresh PEA and try again."), 400
        with AI_JOBS_LOCK:
            previous_job = next((dict(job) for job in AI_JOBS.values() if job.get("client_request_id") == client_request_id), None)
        if previous_job:
            return jsonify(ok=True, job_id=previous_job["id"], status=previous_job.get("status", "queued"),
                           message="PEA recognised this request and resumed its existing AI job instead of submitting a duplicate.")
        raw_workflow = request.form.get("workflow_json", "")
        workflow = _workflow_for_api(raw_workflow)
        prompt = (request.form.get("prompt") or "").strip()
        if not prompt:
            return jsonify(ok=False, error="Describe the motion and visual treatment you want PEA to generate."), 400
        if len(prompt) > 6000:
            return jsonify(ok=False, error="Keep the generation prompt under 6,000 characters."), 400
        prompt_node_id = str(request.form.get("prompt_node_id", ""))
        prompt_input = str(request.form.get("prompt_input", ""))
        prompt_node = workflow.get(prompt_node_id)
        if not prompt_node or prompt_input not in prompt_node.get("inputs", {}):
            return jsonify(ok=False, error="The selected prompt field is not present in the imported workflow. Re-import the API workflow and select the positive prompt field."), 400
        if not isinstance(prompt_node["inputs"][prompt_input], str):
            return jsonify(ok=False, error="The selected prompt input is not a text field. Select a positive text/prompt input node."), 400
        prompt_node["inputs"][prompt_input] = prompt

        image_node_id = str(request.form.get("image_node_id", ""))
        image_input = str(request.form.get("image_input", ""))
        image_file = request.files.get("image")
        if image_file and image_file.filename:
            if not image_file.mimetype or not image_file.mimetype.startswith("image/"):
                return jsonify(ok=False, error="The reference file must be a photo (PNG, JPEG, WEBP or another image format)."), 400
            image_bytes = image_file.read(MAX_AI_IMAGE_BYTES + 1)
            if len(image_bytes) > MAX_AI_IMAGE_BYTES:
                return jsonify(ok=False, error="Reference photos must be 40 MB or smaller. Resize the image and try again."), 413
            if not image_node_id or not image_input:
                return jsonify(ok=False, error="This workflow has no selected image input. Import an LTX image-to-video workflow to animate your uploaded photo."), 400
            image_node = workflow.get(image_node_id)
            if not image_node or image_input not in image_node.get("inputs", {}):
                return jsonify(ok=False, error="The selected image field is not present in this workflow. Re-import the API workflow and select its Load Image node."), 400
            upload_response = _engine_request(
                "POST", engine_url, "/upload/image",
                files={"image": (Path(str(image_file.filename).replace("\\", "/")).name or "pea-reference.png", image_bytes, image_file.mimetype)},
                data={"type": "input", "overwrite": "true"}, timeout=(10, 120),
            ).json()
            image_name = str(upload_response.get("name") or "")
            if not image_name:
                return jsonify(ok=False, error="ComfyUI accepted the upload but did not return an image filename."), 502
            subfolder = str(upload_response.get("subfolder") or "").strip("/")
            workflow[image_node_id]["inputs"][image_input] = f"{subfolder}/{image_name}" if subfolder else image_name
            # LTX's combined text/image workflow includes a bypass switch. Turn on
            # image conditioning when one is present, while leaving other fields alone.
            for node in workflow.values():
                if not isinstance(node, dict):
                    continue
                for key in list((node.get("inputs") or {}).keys()):
                    low = str(key).lower()
                    if low in {"use_image_input", "enable_image_input", "use_image"}:
                        node["inputs"][key] = True
                    elif low in {"bypass_i2v", "bypass_image_input"}:
                        node["inputs"][key] = False
        else:
            image_name = ""

        comfy_client_id = str(uuid.uuid4())
        queued = _engine_request("POST", engine_url, "/prompt", json={"prompt": workflow, "client_id": comfy_client_id}, timeout=(10, 60)).json()
        prompt_id = queued.get("prompt_id")
        if not prompt_id:
            detail = queued.get("error") or queued.get("node_errors") or queued
            return jsonify(ok=False, error=f"ComfyUI did not queue this workflow: {str(detail)[:1200]}"), 422
        job_id = str(uuid.uuid4())
        _prune_ai_jobs()
        _store_ai_job({
            "id": job_id, "engine_url": engine_url, "prompt_id": str(prompt_id),
            "client_id": comfy_client_id, "client_request_id": client_request_id,
            "status": "queued", "created_at": time.time(),
            "prompt": prompt, "image_name": image_name,
            "prompt_node_id": prompt_node_id, "prompt_input": prompt_input,
            "image_node_id": image_node_id, "image_input": image_input,
            "source_asset_id": str(request.form.get("source_asset_id", "")),
            "outputs": [], "error": "",
        })
        return jsonify(ok=True, job_id=job_id, status="queued",
                       message="Your advert scene is in the AI engine queue. PEA will keep checking until the result is ready.")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except RuntimeError as exc:
        return jsonify(ok=False, error=str(exc)), 502
    except Exception as exc:
        app.logger.exception("PEA AI generation submission failed")
        return jsonify(ok=False, error=f"PEA could not submit this generation ({exc.__class__.__name__}). Your project and uploaded materials are safe."), 502


@app.get("/api/ai/jobs/latest")
def ai_job_latest():
    rejected = login_required_json()
    if rejected:
        return rejected
    with AI_JOBS_LOCK:
        jobs = [dict(job) for job in AI_JOBS.values()]
    if not jobs:
        return jsonify(ok=True, job=None)
    latest = max(jobs, key=lambda item: float(item.get("created_at", 0)))
    public_fields = (
        "id", "status", "created_at", "prompt", "engine_url", "outputs", "error", "message",
        "prompt_node_id", "prompt_input", "image_node_id", "image_input", "source_asset_id",
    )
    return jsonify(ok=True, job={key: latest.get(key) for key in public_fields})


@app.get("/api/ai/jobs/<job_id>")
def ai_job_status(job_id):
    rejected = login_required_json()
    if rejected:
        return rejected
    with AI_JOBS_LOCK:
        job = AI_JOBS.get(job_id)
        if not job:
            return jsonify(ok=False, error="This generation record is no longer in memory. It may have expired or the PEA server restarted. Your ComfyUI output files are not deleted."), 404
        snapshot = dict(job)
    if snapshot.get("status") in {"complete", "failed", "cancelled"}:
        return jsonify(ok=True, **{key: snapshot.get(key) for key in ("id", "status", "outputs", "error", "message")})
    try:
        history_response = _engine_request("GET", snapshot["engine_url"], f"/history/{snapshot['prompt_id']}", timeout=(8, 20)).json()
        entry = history_response.get(snapshot["prompt_id"]) if isinstance(history_response, dict) else None
        if entry:
            status_info = entry.get("status") or {}
            status_str = str(status_info.get("status_str") or "").lower()
            messages = status_info.get("messages") or []
            if status_str in {"error", "failed", "failure"} or status_info.get("completed") is False and status_info.get("exception_message"):
                details = status_info.get("exception_message") or json.dumps(messages, ensure_ascii=False)[:1500] or "The workflow failed inside ComfyUI."
                _update_ai_job(job_id, status="failed", error=str(details)[:2000])
            else:
                outputs = _extract_comfy_outputs(entry)
                if outputs:
                    _update_ai_job(job_id, status="complete", outputs=outputs, message="Your AI-generated result is ready.")
                elif status_info.get("completed") or status_str in {"success", "completed"}:
                    _update_ai_job(job_id, status="failed", error="The workflow finished but did not save a video or image output. In ComfyUI, add/keep a Save Video output node and export that workflow in API format.")
                else:
                    _update_ai_job(job_id, status="running")
        else:
            queue = _engine_request("GET", snapshot["engine_url"], "/queue", timeout=(8, 20)).json()
            queue_ids = []
            for key in ("queue_running", "queue_pending"):
                for row in queue.get(key, []) if isinstance(queue, dict) else []:
                    if isinstance(row, (list, tuple)) and len(row) > 1:
                        queue_ids.append(str(row[1]))
                    elif isinstance(row, dict):
                        queue_ids.append(str(row.get("prompt_id", "")))
            new_status = "running" if snapshot["prompt_id"] in queue_ids else "queued"
            _update_ai_job(job_id, status=new_status)
    except (RuntimeError, requests.RequestException) as exc:
        # A temporary engine/network drop is not immediately treated as a failed
        # generation. The browser can retry status polling without submitting twice.
        return jsonify(ok=True, id=job_id, status="checking", error=str(exc),
                       message="The AI engine is temporarily unreachable. PEA will keep your job record and can check again.")
    with AI_JOBS_LOCK:
        latest = dict(AI_JOBS.get(job_id, snapshot))
    return jsonify(ok=True, id=job_id, status=latest.get("status"), outputs=latest.get("outputs", []),
                   error=latest.get("error", ""), message=latest.get("message", ""))


@app.get("/api/ai/jobs/<job_id>/output/<int:index>")
def ai_job_output(job_id, index):
    rejected = login_required_json()
    if rejected:
        return rejected
    with AI_JOBS_LOCK:
        job = AI_JOBS.get(job_id)
        if not job or job.get("status") != "complete":
            return jsonify(ok=False, error="This AI result is not ready yet."), 409
        outputs = job.get("outputs", [])
        if index < 0 or index >= len(outputs):
            return jsonify(ok=False, error="That output does not exist."), 404
        selected = dict(outputs[index])
        base_url = job["engine_url"]
    try:
        response = _engine_request("GET", base_url, "/view", params={
            "filename": selected["filename"], "subfolder": selected["subfolder"], "type": selected["type"],
        }, timeout=(10, 180))
        mime = selected.get("mime_type") or response.headers.get("Content-Type") or "application/octet-stream"
        safe_name = Path(selected["filename"]).name
        return send_file(__import__("io").BytesIO(response.content), mimetype=mime, as_attachment=True,
                         download_name=safe_name, max_age=0)
    except RuntimeError as exc:
        return jsonify(ok=False, error=str(exc)), 502


@app.post("/api/ai/jobs/<job_id>/cancel")
def ai_job_cancel(job_id):
    rejected = _ai_auth_and_csrf_error()
    if rejected:
        return rejected
    with AI_JOBS_LOCK:
        job = AI_JOBS.get(job_id)
        if not job:
            return jsonify(ok=False, error="This generation is no longer in PEA's queue records."), 404
        snapshot = dict(job)
    try:
        # Remove this prompt from the pending queue. Only interrupt the GPU when
        # this exact prompt is the active job, so PEA never stops another workflow.
        queue_data = _engine_request("GET", snapshot["engine_url"], "/queue", timeout=(5, 15)).json()
        running_here = False
        for row in queue_data.get("queue_running", []) if isinstance(queue_data, dict) else []:
            if isinstance(row, (list, tuple)) and len(row) > 1 and str(row[1]) == snapshot["prompt_id"]:
                running_here = True
            elif isinstance(row, dict) and str(row.get("prompt_id", "")) == snapshot["prompt_id"]:
                running_here = True
        _engine_request("POST", snapshot["engine_url"], "/queue", json={"delete": [snapshot["prompt_id"]]}, timeout=(5, 15))
        if running_here:
            _engine_request("POST", snapshot["engine_url"], "/interrupt", json={}, timeout=(5, 15))
        _update_ai_job(job_id, status="cancelled", message="Generation cancelled. Your source files and other projects are untouched.")
        return jsonify(ok=True, status="cancelled")
    except RuntimeError as exc:
        return jsonify(ok=False, error=f"PEA could not reach the AI engine to cancel the job: {exc}"), 502


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(BASE_DIR / "static", "manifest.webmanifest", mimetype="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    response = make_response(send_from_directory(BASE_DIR / "static", "sw.js", mimetype="application/javascript"))
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.errorhandler(413)
def too_large(_error):
    if request.path.startswith("/api/"):
        return jsonify(ok=False, error="This export is too large for the current server limit (1.5 GB). Try 720p or a shorter video."), 413
    return "Request too large", 413


if __name__ == "__main__":
    # Local development only. For deployment use the Procfile / Dockerfile.
    app.config["SESSION_COOKIE_SECURE"] = False
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
