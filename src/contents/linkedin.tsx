import { Button } from "~components/ui/button"
import { createTRPCProxyClient } from "@trpc/client"
import cssText from "data-text:~style.css"
import { ChevronLeft, ChevronRight, Loader2, RefreshCcw, Upload } from 'lucide-react'
import type { PlasmoCSConfig } from "plasmo"
import React, { useCallback, useEffect, useState, useRef } from "react"
import { chromeLink } from "trpc-chrome/link"
import { useStorage } from "@plasmohq/storage/hook"

import type { JobPosting } from "~db"
import { JobList } from "~components/sidebar/JobList"
import { Switch } from "~components/ui/switch"
import { Label } from "~components/ui/label"
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

export default function App() {
  const [isOpen, setIsOpen] = useStorage("earlybird-isOpen", (v) => v === undefined ? false : v)
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConnectionsOnly, setShowConnectionsOnly] = useStorage("earlybird-showConnectionsOnly", false)
  const [connectionCount, setConnectionCount] = useStorage("earlybird-connectionCount", 0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleSidebar = useCallback(() => setIsOpen(!isOpen), [isOpen, setIsOpen])

  useEffect(() => {
    const fetchJobs = async () => {
      const { jobs: fetchedJobs } = await chromeClient.getSavedJobs.query()
      setJobs(fetchedJobs as JobPosting[])
    }
    fetchJobs()
  }, [])

  useEffect(() => {
    // Clear previous highlights
    document.querySelectorAll('.earlybird-highlight').forEach(el => {
      el.classList.remove('earlybird-highlight');
    });

    const jobsWithConnection = jobs.filter(job => job.hasConnection);
    
    if (jobsWithConnection.length > 0) {
        jobsWithConnection.forEach(job => {
            // LinkedIn job cards can be identified by an attribute containing their URN
            const jobCard = document.querySelector(`li[data-entity-urn='${job.urn}']`);
            if (jobCard) {
                jobCard.classList.add('earlybird-highlight');
            }
        });
    }
  }, [jobs]);

  const refreshJobs = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { jobs: fetchedJobs } = await chromeClient.refreshJobs.query()
      setJobs(fetchedJobs as JobPosting[])
    } catch (err) {
      setError("Failed to fetch jobs. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }, [setJobs, setIsLoading, setError])

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsLoading(true)
    setError(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const content = e.target?.result as string
      try {
        const result = await chromeClient.uploadConnectionsCsv.mutate({ csvContent: content })
        if (result.success) {
          setConnectionCount(result.count)
          await refreshJobs() // Refresh jobs to apply connection data
        }
      } catch (err) {
        setError("Failed to upload or process CSV.")
      } finally {
        setIsLoading(false)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className={`fixed bg-bg border-l-8 border-black inset-y-0 right-0 w-full max-w-[34%] min-w-[40rem] drop-shadow-2xl flex flex-col transition-transform duration-200 ease-in-out p-1 ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
      <Button className="absolute -left-28 top-[3%] h-20 bg-main" onClick={toggleSidebar}>
        {isOpen ? <ChevronRight className="h-10 w-10" /> : <ChevronLeft className="h-10 w-10" />}
      </Button>
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b bg-gradient-to-r from-primary to-primary-foreground text-primary-foreground">
          <h2 className="text-3xl font-bold mb-4">Connection Job Finder</h2>

          <div className="bg-primary-foreground/10 p-4 rounded-lg mb-4 text-sm">
            <h3 className="font-bold text-lg mb-2">How to use:</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to LinkedIn's <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer" className="underline">Data Privacy Settings</a>.</li>
              <li>Select "Connections" and download your data as a CSV file.</li>
              <li>Click the "Upload Connections CSV" button below and select the file.</li>
            </ol>
          </div>

          <div className="flex items-center space-x-4">
            <input type="file" ref={fileInputRef} onChange={handleCsvUpload} accept=".csv" className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Connections CSV
            </Button>
            <Button onClick={refreshJobs} disabled={isLoading}>
              {isLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Refreshing...</>
              ) : (
                <><RefreshCcw className="mr-2 h-4 w-4" />Refresh Jobs</>
              )}
            </Button>
          </div>
          {connectionCount > 0 && <p className="text-xs mt-2">Loaded {connectionCount} companies from your connections.</p>}
        </div>

        <div className="p-4 flex items-center justify-between border-b">
            <Label htmlFor="connections-only-switch" className="text-lg">
                Show only jobs with connections
            </Label>
            <Switch
                id="connections-only-switch"
                checked={showConnectionsOnly}
                onCheckedChange={setShowConnectionsOnly}
            />
        </div>

        <JobList
          jobs={jobs}
          filterOptions={{ showConnectionsOnly }}
          error={error}
        />
      </div>
    </div>
  )
}