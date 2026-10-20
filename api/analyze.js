const AdmZip = require("adm-zip");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "apk-archive-inspector",
      version: "0.1.0",
      ready: true,
      capability: "archive-inspection-only",
      note: "This endpoint inspects ZIP entries only. It does not decode compiled Android resources, translate strings, rebuild, or sign APKs."
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Chỉ hỗ trợ GET và POST." });
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  const MAX_BYTES = 4 * 1024 * 1024;
  if (declaredLength > MAX_BYTES) {
    return res.status(413).json({
      error: "APK vượt giới hạn 4 MiB của bản kiểm tra thử nghiệm.",
      detail: "Đây là giới hạn của endpoint thử nghiệm trên Vercel, không phải giới hạn chung của APK."
    });
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        return res.status(413).json({ error: "Tệp vượt giới hạn 4 MiB của endpoint thử nghiệm." });
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return res.status(400).json({ error: "Dữ liệu không có chữ ký ZIP hợp lệ. APK phải là tệp APK nguyên vẹn." });
    }
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (!entries.length) return res.status(400).json({ error: "Kho lưu trữ APK rỗng hoặc không hợp lệ." });
    const names = entries.map(e => e.entryName);
    const suspicious = names.filter(n => n.startsWith("/") || n.split("/").includes(".."));
    if (suspicious.length) return res.status(400).json({ error: "Kho lưu trữ chứa đường dẫn không an toàn." });
    const top = names.slice(0, 300).map(name => ({
      path: name,
      kind: name === "resources.arsc" ? "compiled-resource-table" :
        name === "AndroidManifest.xml" ? "compiled-manifest" :
        /^res\/values[^/]*\/.*\.xml$/i.test(name) ? "possible-string-resource" :
        /\.(dex|so)$/i.test(name) ? "native-or-bytecode" :
        /\.(png|webp|jpg|jpeg)$/i.test(name) ? "image" : "other"
    }));
    const valuesXml = names.filter(n => /^res\/values[^/]*\/[^/]+\.xml$/i.test(n));
    return res.status(200).json({
      ok: true,
      capability: "archive-inspection-only",
      archiveEntries: names.length,
      entriesReturned: top.length,
      truncated: names.length > top.length,
      hasCompiledResourceTable: names.includes("resources.arsc"),
      hasManifest: names.includes("AndroidManifest.xml"),
      possibleValuesXml: valuesXml,
      counts: {
        dex: names.filter(n => /\.dex$/i.test(n)).length,
        nativeLibraries: names.filter(n => /\.so$/i.test(n)).length,
        images: names.filter(n => /\.(png|webp|jpg|jpeg)$/i.test(n)).length
      },
      entries: top,
      nextStep: "Bản này mới kiểm kê ZIP. Phần cốt lõi cần tích hợp Apktool hoặc công cụ tương đương để giải mã resources.arsc/binary XML, dịch chuỗi, build và ký APK."
    });
  } catch (err) {
    return res.status(400).json({ error: "Không thể đọc APK/ZIP.", detail: "Tệp có thể hỏng, mã hóa hoặc không phải APK hợp lệ." });
  }
};