import React, { useMemo } from "react"
import AutoSizer from "react-virtualized-auto-sizer"
import { FixedSizeList as List } from "react-window"

import type { JobPosting } from "~db"

import { JobCard } from "./JobCard"

interface JobListProps {
  jobs: JobPosting[]
  filterOptions: {
    showConnectionsOnly: boolean
  }
  error: string | null
}

const ROW_HEIGHT = 160 // Estimated height for a job card

export const JobList: React.FC<JobListProps> = ({
  jobs,
  filterOptions,
  error
}) => {
  const filteredJobs = useMemo(() => {
    if (!filterOptions.showConnectionsOnly) {
      return jobs
    }
    return jobs.filter((job) => job.hasConnection)
  }, [jobs, filterOptions.showConnectionsOnly])

  const renderJob = ({ index, style }) => (
    <div style={style} className="pr-4 pb-4">
      <JobCard job={filteredJobs[index]} />
    </div>
  )

  return (
    <div className="flex-1 overflow-y-hidden py-6 pl-6">
      {error && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert">
          <span className="block sm:inline">{error}</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <h3 className="font-semibold text-lg">Jobs Found</h3>
          <span className="text-sm text-muted-foreground">
            ({filteredJobs.length})
          </span>
        </div>
      </div>
      <div className="h-[calc(100vh-250px)] overflow-hidden">
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              itemCount={filteredJobs.length}
              itemSize={ROW_HEIGHT}
              width={width}
              className="scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-200">
              {renderJob}
            </List>
          )}
        </AutoSizer>
        {jobs.length === 0 && !error && (
            <div className="text-center p-8">
                <p className="text-lg text-muted-foreground">No jobs found.</p>
                <p className="text-sm text-muted-foreground mt-2">
                    Click "Refresh Jobs" to start a new search.
                </p>
            </div>
        )}
      </div>
    </div>
  )
}
