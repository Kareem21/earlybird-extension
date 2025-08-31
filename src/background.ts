import { Storage } from "@plasmohq/storage"
import { initTRPC } from "@trpc/server"
import { createChromeHandler } from "trpc-chrome/adapter"
import * as z from "zod"
import Papa from "papaparse"
import { db } from "~db"
import pLimit from "p-limit"

/** ⚠️ If you share the extension publicly, proxy this server-side and keep the key off the client. */
const LIMA_API_KEY = "a9fe0807-c786-4fe6-a046-a49a9f44cbce"

/* --------------------------- constants --------------------------- */
const BATCH_SIZE = 30
const BATCH_DELAY_MS = 12_000 // 10–20s as discussed
const CONCURRENCY = 5
const MAX_RETRIES_429 = 4
const EXTRA_PAUSE_AFTER_429_MS = 60_000 // chill if we saw rate-limits in a batch

/* --------------------------- storage helpers --------------------------- */

type LimaProgress = {
    total: number
    cached: number
    fetched: number
    failed: number
    paused: boolean
    done?: boolean
    message?: string
}

const LOCAL_KEYS = {
    connectionsImportedAt: "earlybird_connectionsImportedAt",
    connectionsHash: "earlybird_connectionsHash",
    limaProgress: "earlybird_limaProgress"
}

function getLocal<T>(key: string, defaultValue: T): Promise<T> {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (res) => {
            const val = res?.[key]
            resolve(val === undefined ? defaultValue : (val as T))
        })
    })
}

function setLocal<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve())
    })
}

async function setProgress(progress: Partial<LimaProgress>) {
    const prev = await getLocal<LimaProgress>(LOCAL_KEYS.limaProgress, {
        total: 0,
        cached: 0,
        fetched: 0,
        failed: 0,
        paused: false,
        done: true
    })
    await setLocal(LOCAL_KEYS.limaProgress, { ...prev, ...progress })
}

async function resetProgress(p: LimaProgress) {
    await setLocal(LOCAL_KEYS.limaProgress, p)
}

/* --------------------------- utils --------------------------- */

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input)
    const digest = await self.crypto.subtle.digest("SHA-256", data)
    const bytes = new Uint8Array(digest)
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
}

function normalizeCompanyName(name: string): string {
    const lowered = name.toLowerCase().trim()
    const noPunct = lowered.replace(/[.,™®©]/g, "")
    return noPunct
        .replace(/\b(inc|incorporated|corp|corporation|llc|l\.l\.c|ltd|limited|sa|plc|gmbh|s\.?p\.?a\.?)\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

function extractCompanyFromProfile(profileData: any): string | null {
    if (profileData?.experiences?.length > 0) {
        const c = profileData.experiences[0]?.company
        if (c) return String(c).trim()
    }
    if (typeof profileData?.headline === "string" && profileData.headline.includes(" at ")) {
        const parts = profileData.headline.split(" at ")
        if (parts.length > 1) return parts[1].trim()
    }
    return null
}

function normalizeLinkedInUrl(u: string): string {
    try {
        const url = new URL(u.trim())
        if (url.hostname === "linkedin.com") url.hostname = "www.linkedin.com"
        url.search = ""
        url.pathname = url.pathname.replace(/\/+$/, "")
        return url.toString()
    } catch {
        return u.trim()
    }
}

/* --------------------------- CSV parsing --------------------------- */

function extractUrlsFromLinkedInCsv(csvRaw: string): string[] {
    const csv = csvRaw.replace(/^\uFEFF/, "")
    const lines = csv.replace(/\r\n/g, "\n").split("\n")

    const headerIdx = lines.findIndex(
        (l) =>
            /(^|[;,])\s*URL\s*([;,]|$)/i.test(l) ||
            /(^|[;,])\s*(Public\s+Profile\s+URL|Profile\s+URL)\s*([;,]|$)/i.test(l)
    )

    if (headerIdx < 0) {
        throw new Error("Could not find a 'URL' column in the CSV (is this the LinkedIn Connections export?).")
    }

    const sliced = lines.slice(headerIdx).join("\n")

    const parsed = Papa.parse(sliced, {
        header: true,
        skipEmptyLines: "greedy"
    })

    const urlFieldCandidates = ["url", "public profile url", "profile url"]
    const urlField = parsed.meta.fields?.find((f) => urlFieldCandidates.includes(f.trim().toLowerCase()))

    if (!urlField) {
        throw new Error(`CSV parsed but no URL-like column found. Columns: ${parsed.meta.fields?.join(", ")}`)
    }

    const urls = (parsed.data as any[])
        .map((row) => (row?.[urlField] ?? "").toString().trim())
        .filter(Boolean)

    return urls
}

/* --------------------------- Lima API --------------------------- */

async function fetchPerson(url: string): Promise<{ ok: boolean; profile?: any; status?: number; text?: string }> {
    const endpoint = new URL("https://api.limadata.com/api/v1/person")
    endpoint.searchParams.set("url", url)

    try {
        const res = await fetch(endpoint.toString(), {
            headers: { "X-Api-Key": LIMA_API_KEY }
        })
        if (!res.ok) {
            const text = await res.text().catch(() => "")
            return { ok: false, status: res.status, text }
        }
        const json = await res.json()
        return { ok: true, profile: json }
    } catch (e: any) {
        return { ok: false, status: 0, text: e?.message || "network error" }
    }
}

/* --------------------------- queue runner --------------------------- */

async function runLimaQueue(urls: string[]) {
    if (!urls.length) return

    let progress = await getLocal<LimaProgress>(LOCAL_KEYS.limaProgress, {
        total: urls.length,
        cached: 0,
        fetched: 0,
        failed: 0,
        paused: false,
        done: false
    })

    const batches = chunk(urls, BATCH_SIZE)

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]
        const limit = pLimit(CONCURRENCY)
        let saw429 = false

        await Promise.all(
            batch.map((url) =>
                limit(async () => {
                    // skip if already cached (race safety)
                    const cached = await db.personProfileCache.get(url)
                    if (cached) {
                        progress.cached += 1
                        await setProgress({ cached: progress.cached })
                        return
                    }

                    let attempt = 0
                    let backoffMs = 5000

                    /* retry loop */
                    while (attempt <= MAX_RETRIES_429) {
                        const res = await fetchPerson(url)
                        if (res.ok && res.profile) {
                            await db.personProfileCache.put({ url, data: res.profile })
                            progress.fetched += 1
                            await setProgress({ fetched: progress.fetched, paused: false, message: "" })
                            return
                        }

                        // classify errors
                        if (res.status === 401 || res.status === 403) {
                            // invalid/forbidden key — abort queue
                            await setProgress({
                                paused: true,
                                message: `Lima auth error (${res.status}). Check API key.`,
                            })
                            throw new Error(`Lima auth error ${res.status}: ${res.text || ""}`)
                        }

                        if (res.status === 429) {
                            saw429 = true
                            attempt++
                            const jitter = Math.floor(Math.random() * 1000)
                            await setProgress({
                                paused: true,
                                message: `Rate limited (429). Retrying in ${Math.round((backoffMs + jitter) / 1000)}s…`
                            })
                            await sleep(backoffMs + jitter)
                            backoffMs *= 2
                            continue
                        }

                        // 5xx transient — retry a couple times
                        if (res.status && res.status >= 500 && attempt < 2) {
                            attempt++
                            await sleep(1500 + Math.random() * 1000)
                            continue
                        }

                        // give up
                        progress.failed += 1
                        await setProgress({
                            failed: progress.failed,
                            paused: false,
                            message: res.text || ""
                        })
                        return
                    }
                })
            )
        )

        // between batches
        if (b < batches.length - 1) {
            if (saw429) {
                await setProgress({
                    paused: true,
                    message: `Hit rate limit. Cooling down for ${Math.round(EXTRA_PAUSE_AFTER_429_MS / 1000)}s…`
                })
                await sleep(EXTRA_PAUSE_AFTER_429_MS)
            } else {
                await setProgress({
                    paused: true,
                    message: `Pausing ${Math.round(BATCH_DELAY_MS / 1000)}s before next batch…`
                })
                await sleep(BATCH_DELAY_MS)
            }
            await setProgress({ paused: false, message: "" })
        }
    }
}

/* --------------------------- tRPC router --------------------------- */

const t = initTRPC.create({
    isServer: false,
    allowOutsideOfServer: true
})

const appRouter = t.router({
    /** Upload and process connections.csv with batching & progress. Returns immediately with initial stats. */
    uploadConnectionsCsv: t.procedure
        .input(z.object({ csvContent: z.string() }))
        .mutation(async ({ input }) => {
            try {
                const urlsRaw = extractUrlsFromLinkedInCsv(input.csvContent)
                if (!urlsRaw.length) throw new Error("No profile URLs found after parsing the CSV.")

                // normalize + dedupe
                const uniqueUrls = Array.from(new Set(urlsRaw.map(normalizeLinkedInUrl)))

                // store connections
                await db.connections.bulkPut(uniqueUrls.map((url) => ({ url })))

                // compute hash
                const hash = await sha256Hex(uniqueUrls.join("\n"))
                const prevHash = await getLocal<string | null>(LOCAL_KEYS.connectionsHash, null)
                const currentCompaniesCount = await db.connectionCompanies.count()

                // Determine which URLs need fetching (not cached)
                const toFetch: string[] = []
                let cachedCount = 0
                for (const url of uniqueUrls) {
                    const cached = await db.personProfileCache.get(url)
                    if (cached) cachedCount++
                    else toFetch.push(url)
                }

                // Initialize progress & start queue (fire-and-forget)
                await resetProgress({
                    total: uniqueUrls.length,
                    cached: cachedCount,
                    fetched: 0,
                    failed: 0,
                    paused: false,
                    done: false,
                    message: toFetch.length ? "Processing…" : "Up to date."
                })

                // If same hash AND we already have companies, skip heavy work; but still return stats
                if (prevHash && prevHash === hash && currentCompaniesCount > 0 && toFetch.length === 0) {
                    await setProgress({ done: true, message: "Already processed. Using cached data." })
                    return {
                        success: true,
                        started: false,
                        total: uniqueUrls.length,
                        cached: cachedCount,
                        queued: 0,
                        count: currentCompaniesCount
                    }
                }

                // Kick off queue asynchronously
                setTimeout(async () => {
                    try {
                        await runLimaQueue(toFetch)

                        // Rebuild company list from ALL cached profiles
                        const cachedProfiles = await db.personProfileCache.toArray()
                        const companiesSet = new Set<string>()
                        for (const row of cachedProfiles) {
                            const company = extractCompanyFromProfile(row.data)
                            if (company) companiesSet.add(normalizeCompanyName(company))
                        }
                        const companyList = Array.from(companiesSet).map((name) => ({ name }))

                        await db.transaction("rw", db.connectionCompanies, async () => {
                            await db.connectionCompanies.clear()
                            if (companyList.length) await db.connectionCompanies.bulkAdd(companyList)
                        })

                        await setLocal(LOCAL_KEYS.connectionsImportedAt, Date.now())
                        await setLocal(LOCAL_KEYS.connectionsHash, hash)

                        await setProgress({
                            done: true,
                            message: "Finished.",
                        })
                    } catch (e: any) {
                        console.error("Queue runner error:", e?.message || e)
                        await setProgress({ paused: true, done: true, message: e?.message || "Queue failed." })
                    }
                }, 0)

                // Return immediately with starting stats
                return {
                    success: true,
                    started: true,
                    total: uniqueUrls.length,
                    cached: cachedCount,
                    queued: toFetch.length,
                    count: currentCompaniesCount // current list; UI will refresh when done
                }
            } catch (error) {
                console.error("Error processing connections CSV:", error)
                if (error instanceof Error) throw new Error(error.message)
                throw new Error("An unknown error occurred while processing the connections CSV.")
            }
        }),

    /** Get the Lima processing progress (for UI polling). */
    getLimaProgress: t.procedure.query(async () => {
        const progress = await getLocal<LimaProgress>(LOCAL_KEYS.limaProgress, {
            total: 0,
            cached: 0,
            fetched: 0,
            failed: 0,
            paused: false,
            done: true,
            message: ""
        })
        return { progress }
    }),

    /** Get the final normalized company list. */
    getConnectionCompanies: t.procedure.query(async () => {
        return { companies: await db.connectionCompanies.toArray() }
    }),

    /** Optional: rebuild company list from current cache (no API calls). */
    refreshCompanies: t.procedure.mutation(async () => {
        const cachedProfiles = await db.personProfileCache.toArray()
        const companiesSet = new Set<string>()
        for (const row of cachedProfiles) {
            const company = extractCompanyFromProfile(row.data)
            if (company) companiesSet.add(normalizeCompanyName(company))
        }
        const companyList = Array.from(companiesSet).map((name) => ({ name }))
        await db.transaction("rw", db.connectionCompanies, async () => {
            await db.connectionCompanies.clear()
            if (companyList.length) await db.connectionCompanies.bulkAdd(companyList)
        })
        return { success: true, count: companyList.length }
    })
})

export type AppRouter = typeof appRouter

createChromeHandler({ router: appRouter })

/* --------------------------- install hook --------------------------- */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
        const clientId = self.crypto.randomUUID()
        const storage = new Storage({ area: "sync" })
        await storage.set("clientId", clientId)
    }
})
