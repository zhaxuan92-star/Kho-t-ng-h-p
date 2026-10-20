import os, re, shutil, subprocess, tempfile, uuid, zipfile
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="APK Vietsub Worker", version="0.3.0")
allowed_origin = os.getenv("ALLOWED_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware, allow_origins=[allowed_origin] if allowed_origin != "*" else ["*"],
    allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"]
)
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_MB", "200")) * 1024 * 1024
WORK_ROOT = Path("/tmp/apk-worker")
WORK_ROOT.mkdir(parents=True, exist_ok=True)

# Conservative starter glossary only. This is not machine translation;
# unknown strings remain unchanged and are reported for review.
GLOSSARY = {
    "Settings": "Cài đặt", "Cancel": "Hủy", "OK": "OK", "Yes": "Có",
    "No": "Không", "Back": "Quay lại", "Next": "Tiếp theo",
    "Continue": "Tiếp tục", "Start": "Bắt đầu", "Exit": "Thoát",
    "Quit": "Thoát", "Close": "Đóng", "Open": "Mở", "Save": "Lưu",
    "Load": "Tải", "Loading...": "Đang tải...", "Loading…": "Đang tải…",
    "Retry": "Thử lại", "Error": "Lỗi", "Warning": "Cảnh báo",
    "Help": "Trợ giúp", "Search": "Tìm kiếm", "Done": "Hoàn tất",
    "Play": "Chơi", "Pause": "Tạm dừng", "Resume": "Tiếp tục",
    "New Game": "Trò chơi mới", "Continue Game": "Tiếp tục trò chơi",
    "Language": "Ngôn ngữ", "Audio": "Âm thanh", "Music": "Nhạc",
    "Sound": "Âm thanh", "Graphics": "Đồ họa", "Controls": "Điều khiển",
    "Exit Game": "Thoát trò chơi", "Are you sure?": "Bạn có chắc không?",
    "Username": "Tên người dùng", "Password": "Mật khẩu",
    "Welcome": "Chào mừng", "Achievements": "Thành tựu",
    "Inventory": "Kho đồ", "Shop": "Cửa hàng", "Buy": "Mua",
    "Sell": "Bán", "Free": "Miễn phí", "Locked": "Đã khóa",
    "Unlocked": "Đã mở khóa", "Level": "Cấp độ", "Score": "Điểm",
    "Health": "Máu", "Resume Game": "Tiếp tục trò chơi",
}

PLACEHOLDER = re.compile(r"%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z]|\{[^{}]+\}|<[^>]+>")
def translate_text(value):
    if not value or not value.strip():
        return value, False
    stripped = value.strip()
    if stripped in GLOSSARY:
        return value.replace(stripped, GLOSSARY[stripped]), True
    # Do not make unsafe guesses about format strings, plurals, HTML or markup.
    if PLACEHOLDER.search(stripped) or "<" in stripped or ">" in stripped:
        return value, False
    return value, False

def run(cmd, cwd=None, timeout=300):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout or "Command failed")[-3000:])
    return p.stdout

def find_tool(name):
    paths = [shutil.which(name)]
    if name == "apksigner":
        paths += ["/usr/lib/android-sdk/build-tools/debian/apksigner",
                  "/usr/lib/android-sdk/build-tools/35.0.0/apksigner",
                  "/usr/lib/android-sdk/build-tools/34.0.0/apksigner"]
    for p in paths:
        if p and Path(p).exists():
            return p
    raise RuntimeError(f"Required tool not found: {name}")

@app.get("/")
def health():
    return {"ok": True, "service": "apk-vietsub-worker", "version": "0.2.0",
            "capabilities": ["apktool-decode", "safe-glossary-pass", "rebuild", "debug-sign", "unity-detection"],
            "limits": {"maxUploadMB": MAX_UPLOAD // (1024*1024), "maxExpandedMB": 1024}, "limitations": ["starter glossary only", "no general AI translation", "Unity/IL2CPP assets need a separate localization extractor", "some APKs cannot be rebuilt"]}

@app.post("/api/translate")
async def translate_apk(file: UploadFile = File(...)):
    filename = file.filename or "upload.apk"
    if not filename.lower().endswith(".apk"):
        raise HTTPException(400, "Chỉ chấp nhận tệp có đuôi .apk.")
    job = WORK_ROOT / uuid.uuid4().hex
    job.mkdir(mode=0o700)
    input_path = job / "input.apk"
    try:
        size = 0
        with input_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, f"APK vượt giới hạn {MAX_UPLOAD // (1024*1024)} MiB.")
                out.write(chunk)
        if size < 8 or not zipfile.is_zipfile(input_path):
            raise HTTPException(400, "Tệp không phải APK/ZIP hợp lệ.")
        with zipfile.ZipFile(input_path) as z:
            infos = z.infolist()
            if len(infos) > 50000:
                raise HTTPException(400, "APK có quá nhiều mục trong kho lưu trữ.")
            if any(i.filename.startswith("/") or ".." in Path(i.filename).parts for i in infos):
                raise HTTPException(400, "APK chứa đường dẫn không an toàn.")
            if sum(i.file_size for i in infos) > 1024 * 1024 * 1024:
                raise HTTPException(413, "Dung lượng giải nén APK vượt 1 GiB.")
        apktool = find_tool("apktool")
        run([apktool, "d", "-f", "-o", str(job / "decoded"), str(input_path)], timeout=300)
        decoded = job / "decoded"
        translated = 0
        unchanged = 0
        reviewed = []
        for xml in decoded.glob("res/values*/**/*.xml"):
            try:
                original = xml.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            # Translate only exact known plain-text XML element bodies.
            # Keep tags/attributes/format specifiers intact.
            def replace_text(match):
                nonlocal translated, unchanged
                raw = match.group(1)
                val = raw
                try:
                    from html import unescape, escape
                    decoded_val = unescape(raw)
                    new_val, did = translate_text(decoded_val)
                    if did:
                        translated += 1
                        return ">" + escape(new_val, quote=False) + "<"
                except Exception:
                    pass
                unchanged += 1
                if raw.strip() and len(reviewed) < 200:
                    reviewed.append(raw.strip()[:160])
                return match.group(0)
            # Plain text between XML tags; avoid CDATA, tags, and attributes.
            updated = re.sub(r">([^<>]+)<", replace_text, original)
            if updated != original:
                xml.write_text(updated, encoding="utf-8")
        if game_profile["engine"] == "Unity":
            # Avoid implying a full game translation: Apktool handles Android resources,
            # not Unity AssetBundles, serialized assets, or IL2CPP game text.
            reviewed.append("UNITY_GAME_ASSETS_DETECTED: Unity assets need Unity-aware extraction; not translated here.")
        output_unsigned = job / "rebuilt-unsigned.apk"
        run([apktool, "b", str(decoded), "-o", str(output_unsigned)], timeout=300)
        signer = find_tool("apksigner")
        keystore = job / "debug.keystore"
        keytool = find_tool("keytool")
        run([keytool, "-genkeypair", "-keystore", str(keystore), "-storepass", "android",
             "-keypass", "android", "-alias", "androiddebugkey", "-keyalg", "RSA",
             "-keysize", "2048", "-validity", "10000", "-dname", "CN=APK Vietsub Debug,O=Local,C=VN"], timeout=60)
        signed = job / "apk-vietsub-debug-signed.apk"
        run([signer, "sign", "--ks", str(keystore), "--ks-pass", "pass:android",
             "--key-pass", "pass:android", "--out", str(signed), str(output_unsigned)], timeout=120)
        verify = run([signer, "verify", "--verbose", str(signed)], timeout=60)
        report = (f"APK được build và ký bằng khóa debug tạm thời. Chuỗi khớp bảng thuật ngữ: {translated}. "
                  f"Chuỗi chưa được dịch/đã bỏ qua: {unchanged}. Đây chưa phải dịch máy toàn diện.")
        return FileResponse(signed, media_type="application/vnd.android.package-archive",
            filename="apk-vietsub-debug-signed.apk",
            headers={"X-Translation-Report": report[:900], "X-Translated-Strings": str(translated),
                     "X-Unchanged-Strings": str(unchanged), "X-Signing": "debug-key", "X-Game-Engine": game_profile["engine"], "X-Scripting-Backend": game_profile["scriptingBackend"]})
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Quá thời gian xử lý APK. Hãy thử APK nhỏ hơn.")
    except Exception as exc:
        # Do not leak filesystem paths or raw tool output to the caller.
        raise HTTPException(422, "Không thể xử lý APK này. Có thể ứng dụng dùng tài nguyên không tương thích hoặc thiếu công cụ build.")
    finally:
        await file.close()
        shutil.rmtree(job, ignore_errors=True)
