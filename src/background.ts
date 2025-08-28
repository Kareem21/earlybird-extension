import { Storage } from "@plasmohq/storage"
import { initTRPC } from '@trpc/server';
import { createChromeHandler } from 'trpc-chrome/adapter';
import { z } from 'zod';
import Papa from 'papaparse';
import { db, type JobPosting } from "~db";

/**
 * On install, generate a random client ID and store it in sync storage.
 * This is used to identify unique users.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason == "install") {
        let clientId = self.crypto.randomUUID()
        const storage = new Storage({ area: "sync" })
        await storage.set("clientId", clientId)
    }
})

const t = initTRPC.create({
    isServer: false,
    allowOutsideOfServer: true,
});

const appRouter = t.router({
    getSavedJobs: t.procedure
        .query(async () => {
            return { jobs: await db.jobPostings.toArray() };
        }),

    uploadConnectionsCsv: t.procedure
        .input(z.object({ csvContent: z.string() }))
        .mutation(async ({ input }) => {
            try {
                const results = Papa.parse(input.csvContent, {
                    header: true,
                    skipEmptyLines: true,
                });

                const companies = new Set<string>();
                for (const row of results.data) {
                    const company = row['Company'];
                    if (company) {
                        companies.add(company.trim());
                    }
                }

                const companyList = Array.from(companies).map(name => ({ name }));

                await db.transaction('rw', db.connectionCompanies, async () => {
                    await db.connectionCompanies.clear();
                    await db.connectionCompanies.bulkAdd(companyList);
                });

                return { success: true, count: companyList.length };
            } catch (error) {
                console.error('Error parsing or saving CSV:', error);
                throw new Error('Failed to process connections CSV');
            }
        }),

    refreshJobs: t.procedure
        .query(async () => {
            try {
                const jobs = await scrapeJobs();
                const connectionCompanies = await db.connectionCompanies.toArray();
                const companyNames = new Set(connectionCompanies.map(c => c.name.toLowerCase()));

                const processedJobs = jobs.map(job => ({
                    ...job,
                    hasConnection: companyNames.has(job.company.toLowerCase()),
                }));

                await db.transaction('rw', db.jobPostings, async () => {
                    await db.jobPostings.clear();
                    await db.jobPostings.bulkAdd(processedJobs);
                });

                return { jobs: processedJobs };
            } catch (error) {
                console.error('Error fetching or processing jobs:', error);
                throw new Error('Failed to fetch jobs');
            }
        }),
});

export type AppRouter = typeof appRouter;

createChromeHandler({
    router: appRouter,
});

// Listener to capture the LinkedIn CSRF token
chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
    const storage = new Storage()
    const headers = details.requestHeaders
    storage.get('linkedin-token-last-updated').then(async (result) => {
        const last_updated = parseInt(result)
        const expired = (!result || Date.now() - last_updated > 32000)
        if (expired) {
            const csrfHeader = headers.find(header => header.name.toLowerCase() === 'csrf-token')
            if (csrfHeader?.value) {
                await storage.set('linkedin-token', csrfHeader.value)
                await storage.set('linkedin-token-last-updated', Date.now().toString())
            }
        }
    })
}, {
    urls: ["https://www.linkedin.com/voyager/api/*"],
}, ["requestHeaders"]);


// Simplified job scraping logic
async function scrapeJobs(): Promise<JobPosting[]> {
    const storage = new Storage()
    const token = await storage.get('linkedin-token')
    const url = `https://www.linkedin.com/voyager/api/graphql?variables=(count:50,jobCollectionSlug:recommended,query:(origin:GENERIC_JOB_COLLECTIONS_LANDING),start:0)&queryId=voyagerJobsDashJobCards.a18f4e75c4ec13a6acae19909e362b3b`;

    const headers = {
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "csrf-token": token,
    };

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            credentials: 'include',
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        const rawData = data.included;
        const allJobPostings: JobPosting[] = [];

        rawData.forEach((entry: any) => {
            if (entry['preDashNormalizedJobPostingUrn']) {
                try {
                    const primaryDescription: string[] = entry.primaryDescription?.text.split("·");
                    const company = primaryDescription.at(0)?.trim() || '';
                    const location = primaryDescription.at(1)?.trim() || entry.secondaryDescription?.text.split("·").at(0)?.trim() || '';

                    const newJob: JobPosting = {
                        urn: entry.entityUrn,
                        jobId: entry.entityUrn.match(/\b\d+\b/gm)[0],
                        runId: Date.now().toString(),
                        title: entry.title?.text,
                        company: company,
                        companyLink: entry.logo?.actionTarget,
                        location: location,
                        remote: location.toLowerCase().includes("remote"),
                        listingDate: entry.footerItems?.find(item => item.type === "LISTED_DATE")?.timeAt,
                        salary: entry.tertiaryDescription?.text?.split("·")[0]?.trim() || '',
                        applyUrl: '', // This needs a separate, more complex call, omitting for now.
                        hasConnection: false, // Will be set later
                    };
                    allJobPostings.push(newJob);
                } catch (e) {
                    console.error("Error parsing a job entry:", e, entry);
                }
            }
        });

        const uniqueJobs = Array.from(new Map(allJobPostings.map(job => [job.jobId, job])).values());
        return uniqueJobs;

    } catch (error) {
        console.error('Error fetching job list:', error);
        throw error;
    }
}
