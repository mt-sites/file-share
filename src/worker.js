// Cloudflare Worker + R2: public downloads, password-protected uploads/deletes.
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

const isAdmin = (req, env) => {
  const p = req.headers.get("x-admin-password") || "";
  return env.ADMIN_PASSWORD && p.length === env.ADMIN_PASSWORD.length && p === env.ADMIN_PASSWORD;
};

async function listAll(bucket) {
  const out = []; let cursor;
  do {
    const r = await bucket.list({ cursor, limit: 1000 });
    out.push(...r.objects); cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

const cleanName = (n) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const B = env.BUCKET;

    // ---- Public: list + download ----
    if (path === "/api/files" && req.method === "GET") {
      const objs = await listAll(B);
      const total = objs.reduce((a, o) => a + o.size, 0);
      objs.sort((a, b) => b.uploaded - a.uploaded);
      return json({
        files: objs.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
        used: total, max: Number(env.MAX_BYTES),
      });
    }

    if (path === "/api/download" && req.method === "GET") {
      const key = url.searchParams.get("key");
      const obj = key && (await B.get(key));
      if (!obj) return new Response("Not found", { status: 404 });
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set("etag", obj.httpEtag);
      h.set("content-length", obj.size);
      h.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(key)}`);
      return new Response(obj.body, { headers: h });
    }

    // ---- Owner only ----
    if (path.startsWith("/api/")) {
      if (!isAdmin(req, env)) return json({ error: "Wrong password" }, 401);

      if (path === "/api/check") return json({ ok: true });

      if (path === "/api/mpu/create" && req.method === "POST") {
        const { name, size, type } = await req.json();
        const used = (await listAll(B)).reduce((a, o) => a + o.size, 0);
        if (used + size > Number(env.MAX_BYTES)) return json({ error: "Not enough space left (5 GB cap)" }, 413);
        let key = cleanName(name);
        if (await B.head(key)) key = Date.now() + "-" + key;
        const up = await B.createMultipartUpload(key, { httpMetadata: { contentType: type || "application/octet-stream" } });
        return json({ key, uploadId: up.uploadId });
      }

      if (path === "/api/mpu/part" && req.method === "PUT") {
        const key = url.searchParams.get("key"), id = url.searchParams.get("uploadId");
        const n = Number(url.searchParams.get("n"));
        const part = await B.resumeMultipartUpload(key, id).uploadPart(n, req.body);
        return json(part);
      }

      if (path === "/api/mpu/complete" && req.method === "POST") {
        const key = url.searchParams.get("key"), id = url.searchParams.get("uploadId");
        const { parts } = await req.json();
        await B.resumeMultipartUpload(key, id).complete(parts);
        return json({ ok: true });
      }

      if (path === "/api/mpu/abort" && req.method === "POST") {
        const key = url.searchParams.get("key"), id = url.searchParams.get("uploadId");
        await B.resumeMultipartUpload(key, id).abort();
        return json({ ok: true });
      }

      if (path === "/api/delete" && req.method === "DELETE") {
        await B.delete(url.searchParams.get("key"));
        return json({ ok: true });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
