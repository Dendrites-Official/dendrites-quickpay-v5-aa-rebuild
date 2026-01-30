const apiBase = process.env.API_BASE_URL;
const adminUser = process.env.ADMIN_USER;
const adminPass = process.env.ADMIN_PASS;

if (!apiBase) throw new Error("Missing API_BASE_URL");
if (!adminUser || !adminPass) throw new Error("Missing ADMIN_USER/ADMIN_PASS");

const url = `${apiBase.replace(/\/$/, "")}/admin/snapshot`;

const auth = Buffer.from(`${adminUser}:${adminPass}`).toString("base64");

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Basic ${auth}`,
    "content-type": "application/json",
  },
  body: "{}",
});

const text = await res.text();
console.log("snapshot status:", res.status);
console.log(text);

process.exit(res.ok ? 0 : 1);
