import { Button } from "~components/ui/button"
import { createTRPCProxyClient } from "@trpc/client"
import cssText from "data-text:~style.css"
import { ChevronLeft, ChevronRight, Loader2, Upload, ExternalLink } from "lucide-react"
import type { PlasmoCSConfig } from "plasmo"
import React, { useCallback, useState, useRef, useEffect } from "react"
import { chromeLink } from "trpc-chrome/link"
import { useStorage } from "@plasmohq/storage/hook"

import type { AppRouter } from "~background"

const port = chrome.runtime.connect()
export const chromeClient = createTRPCProxyClient<AppRouter>({
    links: [chromeLink({ port })]
})

export const config: PlasmoCSConfig = {
    matches: ["https://*.linkedin.com/*"]
}

export const getStyle = () => {
    const style = document.createElement("style")
    style.textContent = cssText
    return style
}

/* ----------------------- UI helpers ----------------------- */

function ensureHighlightStyle() {
    if (document.getElementById("earlybird-highlight-style")) return
    const style = document.createElement("style")
    style.id = "earlybird-highlight-style"
    style.textContent = `
li.earlybird-highlight, article.earlybird-highlight, div.earlybird-highlight {
  outline: 3px solid #22c55e !important;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, .2) inset,
              0 6px 18px rgba(34, 197, 94, .15) !important;
  border-radius: 12px !important;
  background-image: linear-gradient(rgba(34,197,94,.08), rgba(34,197,94,.08)) !important;
}
`
    document.head.appendChild(style)
}

/* ----------------------- matching helpers ----------------------- */

function normalizeName(name: string): string {
    const lowered = name.toLowerCase().trim()
    const noPunct = lowered.replace(/[.,™®©]/g, "")
    return noPunct
        .replace(/\b(inc|incorporated|corp|corporation|llc|l\.l\.c|ltd|limited|sa|plc|gmbh|s\.?p\.?a\.?)\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

function tokenOverlap(a: string, b: string): number {
    const ta = new Set(a.split(/\s+/).filter(Boolean))
    const tb = new Set(b.split(/\s+/).filter(Boolean))
    if (ta.size === 0 || tb.size === 0) return 0
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    return inter / Math.min(ta.size, tb.size)
}

function isCompanyMatch(name: string, set: Set<string>): { ok: boolean; matched?: string } {
    const key = normalizeName(name)
    if (set.has(key)) return { ok: true, matched: key }
    // light fuzzy
    for (const s of set) {
        if (tokenOverlap(key, s) >= 0.6) return { ok: true, matched: s }
    }
    return { ok: false }
}

function getJobIdFromHref(href: string): string | null {
    const m = href.match(/\/jobs\/view\/(\d+)/)
    return m?.[1] ?? null
}

function findJobCardsDynamically(root: ParentNode = document): HTMLElement[] {
    const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'))
    const containers: HTMLElement[] = []
    for (const a of anchors) {
        const card =
            a.closest<HTMLElement>('li[role="listitem"]') ||
            a.closest<HTMLElement>('li[data-occludable-job-id]') ||
            a.closest<HTMLElement>("article") ||
            a.closest<HTMLElement>("li") ||
            a.closest<HTMLElement>("div")
        if (card) containers.push(card)
    }
    return Array.from(new Set(containers))
}

function extractCompanyFromCard(card: Element): string | null {
    const companyAnchor =
        card.querySelector<HTMLAnchorElement>('a[href*="/company/"]') ||
        card.querySelector<HTMLAnchorElement>('a[data-control-name*="company"]')
    if (companyAnchor?.textContent?.trim()) return companyAnchor.textContent.trim()

    const ariaLike =
        card.querySelector<HTMLElement>('[aria-label*="company" i], [data-test*="company" i]')
    if (ariaLike?.textContent?.trim()) return ariaLike.textContent.trim()

    const classLike =
        card.querySelector<HTMLElement>('[class*="company" i]') ||
        card.querySelector<HTMLElement>('[class*="primary-description" i]') ||
        card.querySelector<HTMLElement>('h4[class*="primary" i], h4[class*="description" i]')
    if (classLike?.textContent?.trim()) return classLike.textContent.trim()

    return null
}

function extractTitleFromCard(card: Element): string | null {
    const a = card.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]')
    const t = a?.textContent?.trim()
    if (t && t.length > 1) return t
    const h = card.querySelector<HTMLElement>("h3,h2")
    return h?.textContent?.trim() || null
}

function cardHasConnectionsBadge(card: Element): boolean {
    const texts = Array.from(card.querySelectorAll<HTMLElement>("span,div"))
        .slice(0, 40)
        .map((e) => e.textContent?.trim().toLowerCase() || "")
        .filter(Boolean)
    return texts.some((t) => t.includes("connection") || t.includes("connections"))
}

function getKnownCompanyFromContext(): string | null {
    const url = new URL(location.href)
    if (url.searchParams.has("f_C")) {
        const chip =
            document.querySelector<HTMLElement>('[data-test-reusables-filters-bar] [aria-pressed="true"]') ||
            document.querySelector<HTMLElement>('header h1, header h2')
        const text = chip?.textContent?.trim()
        if (text && text.length > 1) return text
    }
    // Company Jobs page
    const companyHeader =
        document.querySelector<HTMLElement>('a[href^="/company/"] h1, a[href^="/company/"] h2') ||
        document.querySelector<HTMLElement>('[data-test*="organization"] [data-test*="title" i]')
    const cText = companyHeader?.textContent?.trim()
    if (cText && cText.length > 1) return cText
    return null
}

function extractCompanyFromRightRail(): { jobId: string | null; company: string | null } {
    const selectedAnchor =
        document.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"][aria-current="page"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"].active')
    const currentJobId =
        getJobIdFromHref(selectedAnchor?.href || "") ||
        new URL(location.href).searchParams.get("currentJobId")

    const companyAnchor =
        document.querySelector<HTMLAnchorElement>('#main a[href*="/company/"]') ||
        document.querySelector<HTMLAnchorElement>('aside a[href*="/company/"]')
    const company = companyAnchor?.textContent?.trim() || null

    return { jobId: currentJobId, company }
}

/* ----------------------- types ----------------------- */

type MatchedJob = {
    jobId: string
    title: string
    company: string
    href: string
}

/* ----------------------- component ----------------------- */

export default function App() {
    const [isOpen, setIsOpen] = useStorage("earlybird-isOpen", (v) => (v === undefined ? false : v))
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [connectionCount, setConnectionCount] = useStorage("earlybird-connectionCount", 0)
    const [progress, setProgress] = useState<{ total: number; cached: number; fetched: number; failed: number; paused: boolean; done?: boolean; message?: string }>({
        total: 0, cached: 0, fetched: 0, failed: 0, paused: false, done: true, message: ""
    })
    const [matchedJobs, setMatchedJobs] = useState<MatchedJob[]>([])

    const matchedJobsRef = useRef<Map<string, MatchedJob>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)
    const connectionCompanies = useRef<Set<string>>(new Set())
    const jobCompanyCache = useRef<Map<string, string>>(new Map())

    const toggleSidebar = useCallback(() => setIsOpen(!isOpen), [isOpen, setIsOpen])

    useEffect(() => {
        ensureHighlightStyle()
    }, [])

    // Load companies on start & when count changes
    useEffect(() => {
        const fetchConnectionCompanies = async () => {
            try {
                const { companies } = await chromeClient.getConnectionCompanies.query()
                connectionCompanies.current = new Set(companies.map((c) => normalizeName(c.name)))
                scanAndCollect("init")
            } catch (e) {
                console.error("Failed to load companies:", e)
            }
        }
        fetchConnectionCompanies()
    }, [connectionCount])

    // Poll progress if a job is running (also pick up mid-flight state on reload)
    useEffect(() => {
        let timer: number | null = null
        let mounted = true

        const poll = async () => {
            try {
                const { progress } = await chromeClient.getLimaProgress.query()
                if (!mounted) return
                setProgress(progress)
                // when run completes, refresh company list and rescan
                if (progress.done && (progress.total > 0)) {
                    const { companies } = await chromeClient.getConnectionCompanies.query()
                    connectionCompanies.current = new Set(companies.map((c) => normalizeName(c.name)))
                    setConnectionCount(companies.length)
                    scanAndCollect("progress-done")
                }
            } catch {}
        }

        // start polling right away, then every 2s while not done or while paused
        poll()
        timer = window.setInterval(poll, 2000)

        return () => {
            mounted = false
            if (timer) clearInterval(timer)
        }
    }, [])

    /* ----------------------- scanning & collecting ----------------------- */

    const addMatch = (m: MatchedJob) => {
        if (!m.jobId) return
        if (!matchedJobsRef.current.has(m.jobId)) {
            matchedJobsRef.current.set(m.jobId, m)
            setMatchedJobs(Array.from(matchedJobsRef.current.values()))
        }
    }

    const scanAndCollect = useCallback((reason: string) => {
        const cards = findJobCardsDynamically(document)
        if (!cards.length) return

        const knownCompany = getKnownCompanyFromContext()
        const knownKey = knownCompany ? normalizeName(knownCompany) : null
        const knownInSet = !!knownKey && connectionCompanies.current.has(knownKey)

        for (const card of cards) {
            const el = card as HTMLElement
            const jobAnchor = el.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]')
            const href = jobAnchor?.href || ""
            const jobId = href ? getJobIdFromHref(href) : null
            const title = extractTitleFromCard(card) || "Job"

            // match by company on card
            const companyOnCard = extractCompanyFromCard(card)
            if (companyOnCard) {
                const m = isCompanyMatch(companyOnCard, connectionCompanies.current)
                if (m.ok) {
                    el.classList.add("earlybird-highlight")
                    addMatch({ jobId: jobId || `${title}-${href}`, title, company: companyOnCard, href })
                    continue
                }
            }

            // known-company context → all cards match
            if (knownInSet) {
                el.classList.add("earlybird-highlight")
                addMatch({ jobId: jobId || `${title}-${href}`, title, company: knownCompany!, href })
                continue
            }

            // connections badge
            if (cardHasConnectionsBadge(card)) {
                el.classList.add("earlybird-highlight")
                addMatch({ jobId: jobId || `${title}-${href}`, title, company: companyOnCard || "Company", href })
                continue
            }

            // right-rail learned company
            if (jobId && jobCompanyCache.current.has(jobId)) {
                const mapped = jobCompanyCache.current.get(jobId)!
                if (connectionCompanies.current.has(mapped)) {
                    el.classList.add("earlybird-highlight")
                    addMatch({ jobId, title, company: mapped, href })
                    continue
                }
            }
        }
    }, [])

    // Observe DOM + URL changes; learn from right rail
    useEffect(() => {
        let raf: number | null = null
        const debouncedScan = (why: string) => {
            if (raf) cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
                scanAndCollect(why)
                raf = null
            })
        }

        const observer = new MutationObserver((mutations) => {
            // learn company from right rail if present
            const touchedRight = mutations.some((m) => (m.target as Element)?.closest?.("#main, aside"))
            if (touchedRight) {
                const { jobId, company } = extractCompanyFromRightRail()
                if (jobId && company) jobCompanyCache.current.set(jobId, normalizeName(company))
            }
            debouncedScan("mutation")
        })
        observer.observe(document.body, { childList: true, subtree: true })

        // watch SPA URL changes
        let lastHref = location.href
        const urlTimer = window.setInterval(() => {
            if (location.href !== lastHref) {
                lastHref = location.href
                matchedJobsRef.current.clear()
                setMatchedJobs([])
                debouncedScan("url-change")
            }
        }, 600)

        // initial pass
        scanAndCollect("mount")

        return () => {
            observer.disconnect()
            clearInterval(urlTimer)
            if (raf) cancelAnimationFrame(raf)
        }
    }, [scanAndCollect])

    /* ----------------------- CSV upload ----------------------- */

    const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsLoading(true)
        setError(null)
        const reader = new FileReader()
        reader.onload = async (e) => {
            const content = (e.target?.result as string) ?? ""
            try {
                const result = await chromeClient.uploadConnectionsCsv.mutate({ csvContent: content })
                // Start polling progress (effect already running); we just keep spinner until done flips.
                if (!result.success) {
                    setError("Upload failed without a message.")
                    setIsLoading(false)
                    return
                }
                // Let the progress poller handle the UI; we’ll stop spinner when done
                const waitUntilDone = async () => {
                    for (;;) {
                        const { progress } = await chromeClient.getLimaProgress.query()
                        setProgress(progress)
                        if (progress.done) break
                        await new Promise((r) => setTimeout(r, 1500))
                    }
                }
                await waitUntilDone()
                const { companies } = await chromeClient.getConnectionCompanies.query()
                connectionCompanies.current = new Set(companies.map((c) => normalizeName(c.name)))
                setConnectionCount(companies.length)
                scanAndCollect("csv-finished")
            } catch (err) {
                console.error("CSV upload error:", err)
                setError("Failed to upload or process CSV.")
            } finally {
                setIsLoading(false)
            }
        }
        reader.readAsText(file, "utf-8")
    }

    /* ----------------------- UI ----------------------- */

    return (
        <div
            className={`fixed bg-bg border-l-8 border-black inset-y-0 right-0 w-full max-w-[34%] min-w-[40rem] drop-shadow-2xl flex flex-col transition-transform duration-200 ease-in-out p-1 ${
                isOpen ? "translate-x-0" : "translate-x-full"
            }`}
        >
            <Button className="absolute -left-28 top-[3%] h-20 bg-main" onClick={toggleSidebar}>
                {isOpen ? <ChevronRight className="h-10 w-10" /> : <ChevronLeft className="h-10 w-10" />}
            </Button>

            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b bg-gradient-to-r from-primary to-primary-foreground text-primary-foreground">
                    <h2 className="text-3xl font-bold mb-1">Connection Job Finder</h2>

                    <div className="bg-primary-foreground/10 p-4 rounded-lg mb-4 text-sm">
                        <h3 className="font-bold text-lg mb-2">How to use:</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>
                                Go to LinkedIn&apos;s{" "}
                                <a
                                    href="https://www.linkedin.com/mypreferences/d/download-my-data"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    Data Privacy Settings
                                </a>
                                .
                            </li>
                            <li>Select &quot;Connections&quot; and download your data as a CSV file.</li>
                            <li>Click the &quot;Upload Connections CSV&quot; button below and select the file.</li>
                        </ol>
                    </div>

                    <div className="flex items-center gap-3">
                        <input type="file" ref={fileInputRef} onChange={handleCsvUpload} accept=".csv" className="hidden" />
                        <Button onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Uploading / Processing…
                                </>
                            ) : (
                                <>
                                    <Upload className="mr-2 h-4 w-4" />
                                    Upload Connections CSV
                                </>
                            )}
                        </Button>

                        {connectionCount > 0 && (
                            <span className="text-xs opacity-90">Loaded {connectionCount} companies from your connections.</span>
                        )}
                    </div>

                    {/* Progress line */}
                    {(progress.total > 0 && !progress.done) || progress.paused ? (
                        <div className="text-xs mt-2">
              <span>
                Progress: cached {progress.cached}, fetched {progress.fetched}/{progress.total}, failed {progress.failed}
              </span>
                            {progress.message ? <span className="ml-2 opacity-80">({progress.message})</span> : null}
                        </div>
                    ) : null}

                    {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
                </div>

                {/* Matches list */}
                <div className="p-6 overflow-auto">
                    <h3 className="font-semibold text-lg mb-2">Jobs where your friends work</h3>
                    {matchedJobs.length === 0 ? (
                        <p className="text-sm text-gray-500">No matches on this page yet. Scroll the list or change filters.</p>
                    ) : (
                        <ul className="space-y-2">
                            {matchedJobs.map((m) => (
                                <li key={m.jobId} className="flex items-start justify-between gap-3 bg-white/40 rounded-md p-2">
                                    <div className="min-w-0">
                                        <div className="font-medium truncate">{m.title}</div>
                                        <div className="text-xs opacity-80 truncate">{m.company}</div>
                                    </div>
                                    <a
                                        className="text-xs underline whitespace-nowrap flex items-center gap-1"
                                        href={m.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open <ExternalLink className="h-3 w-3" />
                                    </a>
                                </li>
                            ))}
                        </ul>
                    )}

                    <p className="text-center text-gray-500 text-xs mt-4">
                        Matches update automatically as you browse LinkedIn jobs.
                    </p>
                </div>
            </div>
        </div>
    )
}
