// Stores a device's push subscription + its upcoming reminder times.
// POST   /api/push  {subscription, schedule:[{t,title,body,tag}]}
// DELETE /api/push  {endpoint}
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { createHash } from "node:crypto"

const keyOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 40)
const bad = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status })

export default async (req: Request) => {
  const store = getStore({ name: "push-subs", consistency: "strong" })
  let body: any
  try { body = await req.json() } catch { return bad("invalid json") }

  if (req.method === "DELETE") {
    if (typeof body?.endpoint !== "string") return bad("endpoint required")
    await store.delete(keyOf(body.endpoint))
    return Response.json({ ok: true })
  }

  const sub = body?.subscription
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth)
    return bad("invalid subscription")

  const now = Date.now(), horizon = now + 16 * 864e5
  const schedule = (Array.isArray(body.schedule) ? body.schedule : [])
    .filter((x: any) => Number.isFinite(x?.t) && x.t > now - 30 * 60e3 && x.t < horizon)
    .slice(0, 300)
    .map((x: any) => ({ t: Math.round(x.t), title: String(x.title || "").slice(0, 60), body: String(x.body || "").slice(0, 160), tag: String(x.tag || "").slice(0, 30) }))
    .sort((a: any, b: any) => a.t - b.t)

  const k = keyOf(sub.endpoint)
  const prev: any = await store.get(k, { type: "json" })
  await store.setJSON(k, {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    schedule,
    sentUntil: prev?.sentUntil ?? now,
    updated: now,
  })
  return Response.json({ ok: true, count: schedule.length })
}

export const config: Config = { path: "/api/push", method: ["POST", "DELETE"] }
