import { Button } from "~components/ui/button"
import { createTRPCProxyClient } from "@trpc/client"
import cssText from "data-text:~style.css"
import { ChevronLeft, ChevronRight, Loader2, Upload } from 'lucide-react'
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

export default function App() {
  const [isOpen, setIsOpen] = useStorage("earlybird-isOpen", (v) => v === undefined ? false : v)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionCount, setConnectionCount] = useStorage("earlybird-connectionCount", 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const connectionCompanies = useRef(new Set<string>());

  const toggleSidebar = useCallback(() => setIsOpen(!isOpen), [isOpen, setIsOpen])

  useEffect(() => {
    const fetchConnectionCompanies = async () => {
        const { companies } = await chromeClient.getConnectionCompanies.query();
        connectionCompanies.current = new Set(companies.map(c => c.name.toLowerCase()));
        // After fetching, we might want to trigger a scan of the current DOM
        scanForJobCards();
    };
    fetchConnectionCompanies();
  }, [connectionCount]); // Re-fetch when connection count changes

  const scanForJobCards = useCallback(() => {
    const jobCards = document.querySelectorAll('li.jobs-search-results__list-item');
    jobCards.forEach((card) => {
        const companyNameEl = card.querySelector('h4.job-card-container__primary-description');
        if (companyNameEl) {
            const companyName = companyNameEl.textContent.trim().toLowerCase();
            if (connectionCompanies.current.has(companyName)) {
                card.classList.add('earlybird-highlight');
            }
        }
    });
  }, []);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                scanForJobCards();
            }
        }
    });

    // We can observe the body for simplicity, or a more specific container if identified
    const targetNode = document.querySelector('.jobs-search-results-list');
    if (targetNode) {
        observer.observe(targetNode, { childList: true, subtree: true });
    } else {
        // Fallback to body if the specific container is not found
        observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
  }, [scanForJobCards]);


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
              {isLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" />Upload Connections CSV</>
              )}
            </Button>
          </div>
          {connectionCount > 0 && <p className="text-xs mt-2">Loaded {connectionCount} companies from your connections.</p>}
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </div>

        <div className="p-6 text-center text-gray-500">
          <p>Upload your connections CSV to get started.</p>
          <p className="text-sm mt-2">Once uploaded, job postings on LinkedIn from companies where you have connections will be automatically highlighted.</p>
        </div>
      </div>
    </div>
  )
}