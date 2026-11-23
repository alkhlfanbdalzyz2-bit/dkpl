// Runs every 5 minutes (UTC cron; times are stored as absolute epoch ms, so no timezone math here).
// Sends every reminder whose time has passed since the last run (at most 30 min late).
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import webpush from "web-push"

export default async () => {
  const pub = Netlify.env.get("VAPID_PUBLIC_KEY"), priv = Netlify.env.get("VAPID_PRIVATE_KEY")
  if (!pub || !priv) { console.error("VAPID keys missing"); return }
  webpush.setVapidDetails("https://altawazun.netlify.app", pub, priv)

  const store = getStore({ name: "push-subs", consistency: "strong" })
  const { blobs } = await store.list()
  const now = Date.now()
  let sent = 0, removed = 0

  for (const { key } of blobs) {
    const rec: any = await store.get(key, { type: "json" })
    if (!rec?.subscription) continue
    const from = Math.max(rec.sentUntil ?? now - 30 * 60e3, now - 30 * 60e3)
    const due = (rec.schedule || []).filter((x: any) => x.t > from && x.t <= now)
    let gone = false
    for (const x of due) {
      try {
        await webpush.sendNotification(rec.subscription, JSON.stringify({ title: x.title, body: x.body, tag: x.tag }), { TTL: 3600, urgency: "high" })
        sent++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) { gone = true; break }
        console.error("push failed", err?.statusCode, err?.body)
      }
    }
    if (gone) { await store.delete(key); removed++; continue }
    rec.sentUntil = now
    rec.schedule = (rec.schedule || []).filter((x: any) => x.t > now)
    await store.setJSON(key, rec)
  }
  console.log(`reminders: subs=${blobs.length} sent=${sent} removed=${removed}`)
}

export const config: Config = { schedule: "*/5 * * * *" }
