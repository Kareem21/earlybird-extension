import { Storage } from "@plasmohq/storage"
import { initTRPC } from '@trpc/server';
import { createChromeHandler } from 'trpc-chrome/adapter';
import * as z from 'zod';
import Papa from 'papaparse';
import { db } from "~db";
import pLimit from 'p-limit';

const LIMA_API_KEY = 'a9fe0807-c786-4fe6-a046-a49a9f44cbce';

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
    uploadConnectionsCsv: t.procedure
        .input(z.object({ csvContent: z.string() }))
        .mutation(async ({ input }) => {
            const limit = pLimit(5); // Limit to 5 concurrent API calls

            try {
                const results = Papa.parse(input.csvContent, {
                    header: true,
                    skipEmptyLines: true,
                });

                const urls = results.data.map((row: any) => row['URL']).filter(Boolean);
                if (urls.length === 0) {
                    throw new Error("No URLs found in the 'URL' column of the CSV.");
                }

                // Store connections
                const connectionsToStore = urls.map(url => ({ url }));
                await db.connections.bulkPut(connectionsToStore);

                const companies = new Set<string>();

                const promises = urls.map(url => limit(async () => {
                    // 1. Check cache
                    const cachedProfile = await db.personProfileCache.get(url);
                    let profileData: any;

                    if (cachedProfile) {
                        profileData = cachedProfile.data;
                    } else {
                        // 2. Fetch from API if not in cache
                        const response = await fetch(`https://api.limadata.com/api/v1/person?url=${encodeURIComponent(url)}`, {
                            headers: {
                                'X-Api-Key': LIMA_API_KEY
                            }
                        });

                        if (!response.ok) {
                            console.error(`Failed to fetch profile for ${url}: ${response.statusText}`);
                            return; // Skip this profile
                        }
                        profileData = await response.json();

                        // 3. Store in cache
                        await db.personProfileCache.put({ url, data: profileData });
                    }

                    // 4. Extract company from profile data
                    if (profileData.experiences && profileData.experiences.length > 0) {
                        // Get company from the most recent experience
                        const company = profileData.experiences[0].company;
                        if (company) {
                            companies.add(company.trim());
                        }
                    } else if (profileData.headline) {
                        // Fallback to headline if no experiences
                        const parts = profileData.headline.split(' at ');
                        if (parts.length > 1) {
                            companies.add(parts[1].trim());
                        }
                    }
                }));

                await Promise.all(promises);

                const companyList = Array.from(companies).map(name => ({ name }));

                if (companyList.length > 0) {
                    await db.transaction('rw', db.connectionCompanies, async () => {
                        await db.connectionCompanies.clear();
                        await db.connectionCompanies.bulkAdd(companyList);
                    });
                }

                return { success: true, count: companyList.length };
            } catch (error) {
                console.error('Error processing connections CSV:', error);
                if (error instanceof Error) {
                    throw new Error(error.message);
                }
                throw new Error('An unknown error occurred while processing the connections CSV.');
            }
        }),

    getConnectionCompanies: t.procedure
        .query(async () => {
            return { companies: await db.connectionCompanies.toArray() };
        }),
});

export type AppRouter = typeof appRouter;

createChromeHandler({
    router: appRouter,
});
