# APK Vietsub Worker

Docker worker for APK resource decoding, conservative glossary replacements, rebuild, and debug signing.

## Run locally
```sh
docker build -t apk-vietsub-worker -f worker/Dockerfile .
docker run --rm -p 8080:8080 -e MAX_UPLOAD_MB=100 apk-vietsub-worker
```

Health: `GET /`
Process: `POST /api/translate` as multipart form field named `file`.

## Important limitations
- The included glossary is only a starter dictionary, not general-purpose AI translation.
- Apktool cannot decode/rebuild every application, especially some split APKs, protected apps, or applications with native/server-side text.
- Output is signed with a temporary debug key. It will not update the original app in place; Android usually treats it as a different signer and may refuse to install over the original.
- Do not upload apps you do not have permission to modify.
- Configure a specific ALLOWED_ORIGIN and authentication/rate limiting before public production use.
- Free hosting may sleep, impose resource limits, or change its terms. Large APKs need a worker with sufficient memory and disk.
- Do not expose signing credentials. Production signing requires a user-owned key stored as a secret, never committed to Git.
