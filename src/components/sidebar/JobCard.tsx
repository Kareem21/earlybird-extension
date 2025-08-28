import { Card, CardContent, CardHeader } from "~components/ui/card"
import { DollarSign, MapPin, Users, Link, Briefcase } from "lucide-react";
import React from "react"
import { Badge } from "~components/ui/badge"
import type { JobPosting } from "~db"

interface JobCardProps {
  job: JobPosting
}

export const JobCard: React.FC<JobCardProps> = React.memo(({ job }) => (
  <Card className={`hover:shadow-md transition-shadow bg-card mb-4 border ${job.hasConnection ? 'border-primary' : ''}`}>
    <CardHeader className="pb-2">
      <div className="flex items-start justify-between">
        <h4 className="font-semibold text-lg text-primary hover:underline">
          <a href={`https://www.linkedin.com/jobs/view/${job.jobId}`} target="_blank" rel="noopener noreferrer">
            {job.title}
          </a>
        </h4>
        {job.hasConnection && (
          <Badge variant="default">
            <Users className="h-3 w-3 mr-1" />
            Connection
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Briefcase className="h-4 w-4 text-muted-foreground" />
        <a href={job.companyLink} target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground hover:underline">
          {job.company}
        </a>
      </div>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-2 gap-2 text-sm mb-2">
        <div className="flex items-center text-muted-foreground">
          <DollarSign className="h-4 w-4 mr-2 text-primary" />
          <span>{job.salary || "Not specified"}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <MapPin className="h-4 w-4 mr-2 text-primary" />
          <span>{job.location}</span>
        </div>
      </div>
      <div className="flex flex-row gap-2 mt-3">
        {job.remote && (
          <Badge variant="secondary">Remote</Badge>
        )}
        {job.applyUrl && (
          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
            <Badge variant="outline">
              <Link className="h-3 w-3 mr-1" />
              Apply
            </Badge>
          </a>
        )}
      </div>
    </CardContent>
  </Card>
))
