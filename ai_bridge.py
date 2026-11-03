"""PEA's lightweight, server-side bridge to public community AI demo Spaces.

No local model installation or GPU is required. Public demo availability and
quotas are controlled by the upstream hosts, not by PEA.
"""
from __future__ import annotations

import json
import mimetypes
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse
from urllib.request import Request, urlopen

from flask import jsonify, request, send_file

LTX_SPACE = "https://lightricks-ltx-video-distilled.hf.space"
KOKORO_SPACE = "https://pendrokar-kokoro-tts.hf.space"
MAX_REFERENCE = 12 * 1024 * 1024
MAX_VOICE_CHARS = 450
OUTPUT_DIR = Path(tempfile.gettempdir()) / "pea-ai-output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pea-ai")


def _set_job(job_id: str, **fields) -> None:
    with LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)
            JOBS[job_id]["updated_at"] = time.time()


def _gradio_call(space: str, api_name: str, data: list) -> list:
    endpoint = f"{space}/gradio_api/call/{api_name}"
    body = json.dumps({"data": data}).encode("utf-8")
    req = Request(endpoint, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=90) as response:
            submitted = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[-800:]
        raise RuntimeError(f"The public model rejected the request ({exc.code}). {detail}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"Could not reach the public model: {exc}") from exc
    event_id = submitted.get("event_id") if isinstance(submitted, dict) else None
    if not event_id:
        raise RuntimeError(f"The model did not return a queue ID: {str(submitted)[:400]}")

    poll = Request(f"{space}/gradio_api/call/{api_name}/{quote(str(event_id), safe='')}", headers={"Accept": "text/event-stream"})
    final_data = None
    try:
        with urlopen(poll, timeout=620) as response:
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                value = line[5:].strip()
                if not value or value == "[DONE]":
                    continue
                try:
                    event = json.loads(value)
                except json.JSONDecodeError:
                    continue
                message = event.get("msg") if isinstance(event, dict) else None
                if message == "process_completed":
                    final_data = (event.get("output") or {}).get("data", [])
                    break
                if message in {"process_failed", "error"}:
                    raise RuntimeError(event.get("message") or event.get("error") or "The model could not generate this media.")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[-800:]
        raise RuntimeError(f"Could not collect the model result ({exc.code}). {detail}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"The public model queue did not complete: {exc}") from exc
    if final_data is None:
        raise RuntimeError("The public model closed its queue without a finished result. Please retry the scene.")
    return final_data


def _upload_reference(raw: bytes, filename: str, mime: str) -> dict:
    boundary = "----Pea" + uuid.uuid4().hex
    safe_name = Path(filename).name.replace('"', '')
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{safe_name}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    req = Request(f"{LTX_SPACE}/gradio_api/upload", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with urlopen(req, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"The character reference could not be sent to LTX: {exc}") from exc
    remote_path = result[0] if isinstance(result, list) and result else (result.get("path") if isinstance(result, dict) else None)
    if not remote_path:
        raise RuntimeError("LTX did not accept the reference image.")
    return {"path": remote_path, "orig_name": safe_name, "mime_type": mime, "meta": {"_type": "gradio.FileData"}}


def _find_file(value, kind: str) -> dict | None:
    if isinstance(value, dict):
        path = str(value.get("path") or value.get("url") or "").lower()
        mime = str(value.get("mime_type") or "").lower()
        ext = (".mp4", ".webm", ".mov", ".mkv") if kind == "video" else (".wav", ".mp3", ".ogg", ".flac", ".m4a")
        if (value.get("url") or value.get("path")) and (kind in mime or path.split("?")[0].endswith(ext)):
            return value
        for item in value.values():
            found = _find_file(item, kind) if isinstance(item, (dict, list)) else None
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_file(item, kind)
            if found:
                return found
    return None


def _download(space: str, filedata: dict, suffix: str) -> Path:
    candidate = filedata.get("url")
    if candidate:
        url = urljoin(space + "/", str(candidate))
    elif filedata.get("path"):
        url = f"{space}/gradio_api/file={quote(str(filedata['path']), safe='/')}"
    else:
        raise RuntimeError("The model returned media without a downloadable file link.")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host.endswith(".hf.space") or host.endswith("huggingface.co")):
        raise RuntimeError("The model returned an unrecognised download address; PEA blocked it for safety.")
    fd, filename = tempfile.mkstemp(prefix="pea-ai-", suffix=suffix, dir=str(OUTPUT_DIR))
    os.close(fd)
    path = Path(filename)
    count = 0
    try:
        with urlopen(Request(url, headers={"Accept": "*/*"}), timeout=180) as response, path.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > 700 * 1024 * 1024:
                    raise RuntimeError("The generated file exceeded PEA's 700 MB safety limit.")
                output.write(chunk)
        if not count:
            raise RuntimeError("The model returned an empty media file.")
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _video_worker(job_id: str, prompt: str, duration: float, ratio: str, ref: bytes | None, ref_name: str, ref_mime: str, detail: bool) -> None:
    try:
        _set_job(job_id, status="working", message="Preparing your scene…")
        image = _upload_reference(ref, ref_name, ref_mime) if ref else None
        height, width = {"9:16": (704, 512), "16:9": (512, 704), "1:1": (512, 512)}.get(ratio, (704, 512))
        mode = "image-to-video" if image else "text-to-video"
        inputs = [prompt, "blurry, distorted face, extra fingers, flicker, duplicate people, subtitles, watermark", image, None,
                  height, width, mode, duration, 9, 42, True, 3.0, bool(detail)]
        api = "image_to_video" if image else "text_to_video"
        _set_job(job_id, message="LTX is generating your footage on a shared remote GPU. Keep this tab open…")
        result = _gradio_call(LTX_SPACE, api, inputs)
        filedata = _find_file(result, "video") or _find_file(result, "audio")
        if not filedata:
            raise RuntimeError("LTX did not return a downloadable video. Try the public LTX demo directly.")
        _set_job(job_id, message="Footage generated. Importing it into your PEA library…")
        path = _download(LTX_SPACE, filedata, ".mp4")
        _set_job(job_id, status="done", message="Your scene is ready.", file_path=str(path), filename=f"pea-scene-{job_id[:8]}.mp4", content_type="video/mp4")
    except Exception as exc:
        _set_job(job_id, status="error", message=str(exc)[:900], error=str(exc)[:1200])


def _voice_worker(job_id: str, text: str, voice: str, speed: float) -> None:
    try:
        _set_job(job_id, status="working", message="Kokoro is creating the voice…")
        # use_gpu=False keeps this route on the Space's CPU path, not its ZeroGPU quota.
        result = _gradio_call(KOKORO_SPACE, "generate_first", [text, voice, speed, False, "en-us"])
        filedata = _find_file(result, "audio")
        if not filedata:
            raise RuntimeError("Kokoro did not return a downloadable audio file. Open the Kokoro voice studio directly as a fallback.")
        _set_job(job_id, message="Voice ready. Importing it into your PEA library…")
        path = _download(KOKORO_SPACE, filedata, ".wav")
        _set_job(job_id, status="done", message="Your voice track is ready.", file_path=str(path), filename=f"pea-voice-{job_id[:8]}.wav", content_type="audio/wav")
    except Exception as exc:
        _set_job(job_id, status="error", message=str(exc)[:900], error=str(exc)[:1200])


def register_ai_routes(app, login_required_json, csrf_ok) -> None:
    @app.post("/api/ai/video")
    def pea_ai_video_create():
        rejected = login_required_json()
        if rejected: return rejected
        if not csrf_ok(): return jsonify(ok=False, error="Security check failed. Refresh PEA and try again."), 400
        prompt = (request.form.get("prompt") or "").strip()
        if not prompt: return jsonify(ok=False, error="Describe the scene first."), 400
        if len(prompt) > 2400: return jsonify(ok=False, error="Keep the scene description under 2,400 characters."), 400
        try: duration = float(request.form.get("duration", "3"))
        except (TypeError, ValueError): duration = 3.0
        duration = max(2.0, min(8.5, duration))
        ratio = request.form.get("ratio", "9:16")
        if ratio not in {"9:16", "16:9", "1:1"}: ratio = "9:16"
        detail = request.form.get("detail") == "true"
        upload = request.files.get("reference")
        ref = None; ref_name = "character-reference.jpg"; ref_mime = "image/jpeg"
        if upload and upload.filename:
            ref = upload.read(MAX_REFERENCE + 1)
            if len(ref) > MAX_REFERENCE: return jsonify(ok=False, error="Character reference images must be 12 MB or smaller."), 413
            if not (upload.mimetype or "").startswith("image/"): return jsonify(ok=False, error="Choose an image file for your character reference."), 400
            ref_name = Path(upload.filename).name
            ref_mime = upload.mimetype or ref_mime
        job_id = uuid.uuid4().hex
        with LOCK: JOBS[job_id] = {"id": job_id, "kind": "video", "status": "queued", "message": "Your scene is in the queue.", "created_at": time.time(), "updated_at": time.time()}
        EXECUTOR.submit(_video_worker, job_id, prompt, duration, ratio, ref, ref_name, ref_mime, detail)
        return jsonify(ok=True, job_id=job_id), 202

    @app.post("/api/ai/voice")
    def pea_ai_voice_create():
        rejected = login_required_json()
        if rejected: return rejected
        if not csrf_ok(): return jsonify(ok=False, error="Security check failed. Refresh PEA and try again."), 400
        body = request.get_json(silent=True) or {}
        text = str(body.get("text") or "").strip()
        voice = str(body.get("voice") or "af_heart")
        try: speed = float(body.get("speed", 1.0))
        except (TypeError, ValueError): speed = 1.0
        speed = max(.5, min(2.0, speed))
        allowed = {"af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_nova", "af_sky", "af_alloy", "af_jessica", "af_river", "am_michael", "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx", "am_santa", "am_adam", "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel"}
        if not text: return jsonify(ok=False, error="Write the dialogue or narration first."), 400
        if len(text) > MAX_VOICE_CHARS: return jsonify(ok=False, error=f"Keep each voice clip below {MAX_VOICE_CHARS} characters. Create longer dialogue in separate lines."), 400
        if voice not in allowed: voice = "af_heart"
        job_id = uuid.uuid4().hex
        with LOCK: JOBS[job_id] = {"id": job_id, "kind": "voice", "status": "queued", "message": "Your voice is in the queue.", "created_at": time.time(), "updated_at": time.time()}
        EXECUTOR.submit(_voice_worker, job_id, text, voice, speed)
        return jsonify(ok=True, job_id=job_id), 202

    @app.get("/api/ai/jobs/<job_id>")
    def pea_ai_job_status(job_id):
        rejected = login_required_json()
        if rejected: return rejected
        with LOCK:
            job = JOBS.get(job_id)
            if not job: return jsonify(ok=False, error="This generation job is no longer available. Please submit it again."), 404
            result = {k: job.get(k) for k in ("id", "kind", "status", "message", "error", "filename", "content_type")}
        return jsonify(ok=True, **result)

    @app.get("/api/ai/jobs/<job_id>/download")
    def pea_ai_job_download(job_id):
        rejected = login_required_json()
        if rejected: return rejected
        with LOCK:
            job = JOBS.get(job_id)
            path = Path(job["file_path"]) if job and job.get("file_path") else None
            filename = job.get("filename", "pea-generated-media") if job else "pea-generated-media"
            content_type = job.get("content_type", "application/octet-stream") if job else "application/octet-stream"
        if not path or not path.is_file(): return jsonify(ok=False, error="The generated file is no longer available. Generate it again."), 404
        return send_file(path, mimetype=content_type, as_attachment=True, download_name=filename, max_age=0)
