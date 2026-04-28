import type {
  ImpactRiskLevel,
  SandcastleImpactAnalysisResult,
} from './sandcastle-impact-analysis.js'

export interface RunnableTaskImpact {
  readonly issueNumber: number
  readonly surface: SandcastleImpactAnalysisResult
}

export interface ScheduleBatch {
  readonly issueNumbers: readonly number[]
  readonly mode: 'parallel' | 'sequential'
  readonly reason: string
}

export interface SchedulePlan {
  readonly batches: readonly ScheduleBatch[]
}

export interface PlanBlockedTaskContinuationInput {
  readonly blockedIssueNumber: number
  readonly runnableIssueNumbers: readonly number[]
}

export interface BlockedTaskContinuationPlan {
  readonly continueIssueNumbers: readonly number[]
  readonly recordBlockerForIssueNumber: number
  readonly shouldContinue: boolean
}

export interface RemediationAttempt {
  readonly evidenceFingerprint: string
  readonly strategy: string
}

export interface PlanRemediationAttemptInput {
  readonly lastAttempt: RemediationAttempt
  readonly nextAttempt: RemediationAttempt
}

export interface RemediationAttemptPlan {
  readonly allowed: boolean
  readonly reason: string
}

export const groupRunnableTasksByImpactSurface = (input: {
  readonly tasks: readonly RunnableTaskImpact[]
}): SchedulePlan => {
  if (input.tasks.length === 0) {
    return {
      batches: [],
    }
  }

  if (input.tasks.some((task) => isUncertainRisk(task.surface.riskLevel))) {
    return {
      batches: input.tasks.map((task) =>
        sequentialBatch(task, 'uncertain or high-risk impact surface'),
      ),
    }
  }

  if (input.tasks.some((task) => hasSharedSerializationSurface(task.surface))) {
    return {
      batches: input.tasks.map((task) =>
        sequentialBatch(
          task,
          'shared design, snapshot, or contract surface requires serialization',
        ),
      ),
    }
  }

  const overlappingIssueNumbers = findOverlappingIssueNumbers(input.tasks)

  if (overlappingIssueNumbers.size > 0) {
    return {
      batches: input.tasks.map((task) => {
        const overlappingIssueNumber = overlappingIssueNumbers.get(task.issueNumber)

        return overlappingIssueNumber === undefined
          ? {
              issueNumbers: [task.issueNumber],
              mode: 'parallel',
              reason: 'impact surfaces do not overlap',
            }
          : sequentialBatch(task, `impact surface overlaps with #${String(overlappingIssueNumber)}`)
      }),
    }
  }

  return {
    batches: [
      {
        issueNumbers: input.tasks.map((task) => task.issueNumber),
        mode: 'parallel',
        reason: 'impact surfaces do not overlap',
      },
    ],
  }
}

export const planBlockedTaskContinuation = (
  input: PlanBlockedTaskContinuationInput,
): BlockedTaskContinuationPlan => {
  const continueIssueNumbers = input.runnableIssueNumbers.filter(
    (issueNumber) => issueNumber !== input.blockedIssueNumber,
  )

  return {
    continueIssueNumbers,
    recordBlockerForIssueNumber: input.blockedIssueNumber,
    shouldContinue: continueIssueNumbers.length > 0,
  }
}

export const planRemediationAttempt = (
  input: PlanRemediationAttemptInput,
): RemediationAttemptPlan => {
  const hasNewEvidence =
    input.lastAttempt.evidenceFingerprint !== input.nextAttempt.evidenceFingerprint
  const hasChangedStrategy = input.lastAttempt.strategy !== input.nextAttempt.strategy

  if (!hasNewEvidence && !hasChangedStrategy) {
    return {
      allowed: false,
      reason: 'Repeated remediation requires new evidence or a changed strategy.',
    }
  }

  return {
    allowed: true,
    reason: 'Remediation has new evidence or a changed strategy.',
  }
}

const sequentialBatch = (task: RunnableTaskImpact, reason: string): ScheduleBatch => ({
  issueNumbers: [task.issueNumber],
  mode: 'sequential',
  reason,
})

const isUncertainRisk = (riskLevel: ImpactRiskLevel): boolean => riskLevel === 'high'

const hasSharedSerializationSurface = (surface: SandcastleImpactAnalysisResult): boolean =>
  surface.designFiles.length > 0 ||
  surface.sharedContracts.length > 0 ||
  [...surface.expectedFiles, ...surface.tests].some((filePath) => isSnapshotFile(filePath))

const isSnapshotFile = (filePath: string): boolean =>
  filePath.includes('-snapshots/') || filePath.endsWith('.snap') || filePath.endsWith('.png')

const findOverlappingIssueNumbers = (
  tasks: readonly RunnableTaskImpact[],
): ReadonlyMap<number, number> => {
  const overlaps = new Map<number, number>()

  for (const left of tasks) {
    for (const right of tasks) {
      if (left.issueNumber >= right.issueNumber) {
        continue
      }

      if (surfacesOverlap(left.surface, right.surface)) {
        overlaps.set(left.issueNumber, right.issueNumber)
        overlaps.set(right.issueNumber, left.issueNumber)
      }
    }
  }

  return overlaps
}

const surfacesOverlap = (
  left: SandcastleImpactAnalysisResult,
  right: SandcastleImpactAnalysisResult,
): boolean => {
  const leftSurface = new Set([
    ...left.expectedFiles,
    ...left.expectedModules,
    ...left.designFiles,
    ...left.tests,
    ...left.sharedContracts,
  ])

  return [
    ...right.expectedFiles,
    ...right.expectedModules,
    ...right.designFiles,
    ...right.tests,
    ...right.sharedContracts,
  ].some((entry) => leftSurface.has(entry))
}
