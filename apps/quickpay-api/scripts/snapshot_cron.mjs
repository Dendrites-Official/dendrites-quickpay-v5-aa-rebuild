const apiBase = process.env.API_BASE_URL;
const adminKey = process.env.ADMIN_KEY;

if (!apiBase) throw new Error("Missing API_BASE_URL");
if (!adminKey) throw new Error("Missing ADMIN_KEY");

const url = `${apiBase.replace(/\/$/, "")}/admin/snapshot`;

const res = await fetch(url, {
  method: "POST",
  headers: {
    "x-admin-key": adminKey,
    "content-type": "application/json",
  },
  body: "{}",
});

const text = await res.text();
console.log("snapshot status:", res.status);
console.log(text);

process.exit(res.ok ? 0 : 1);
