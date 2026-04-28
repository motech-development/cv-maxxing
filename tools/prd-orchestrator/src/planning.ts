export interface GitHubIssue {
  readonly body: string
  readonly number: number
  readonly state: string
  readonly title: string
}

export interface ParsedChildTask {
  readonly acceptanceCriteria: readonly string[]
  readonly blockedBy: readonly number[]
  readonly hitlMarkers: readonly string[]
  readonly issueNumber: number
  readonly parentPrdNumber: number
  readonly title: string
  readonly userStoriesAddressed: readonly number[]
  readonly whatToBuild: string
}

export interface ChildTaskDagNode {
  readonly dependencies: readonly number[]
  readonly issueNumber: number
}

export interface UnavailablePrd {
  readonly issueNumber: number
  readonly reason: string
}

export interface SelectedPrdPlan {
  readonly blockers: readonly string[]
  readonly childTaskDag: readonly ChildTaskDagNode[]
  readonly childTasks: readonly ParsedChildTask[]
  readonly issueNumber: number
  readonly nextExecutableTasks: readonly number[]
  readonly title: string
  readonly warnings: readonly string[]
}

export interface DryRunPlan {
  readonly selectedPrd: SelectedPrdPlan | undefined
  readonly unavailablePrds: readonly UnavailablePrd[]
}

interface MarkdownSection {
  readonly content: string
  readonly title: string
}

interface DependencyValidation {
  readonly blockers: readonly string[]
  readonly dag: readonly ChildTaskDagNode[]
}

const prdTitlePrefix = 'PRD:'

const hitlMarkerPatterns = [
  {
    label: 'HITL',
    pattern: /^\s*(?:[-*]\s*)?(?:\[?HITL\]?|HITL)\s*:/i,
  },
  {
    label: 'unresolved-decision',
    pattern: /^\s*(?:[-*]\s*)?unresolved[- ]decision\s*:/i,
  },
  {
    label: 'human input',
    pattern: /^\s*(?:[-*]\s*)?human input\s*:/i,
  },
  {
    label: 'needs decision',
    pattern: /^\s*(?:[-*]\s*)?needs decision\s*:/i,
  },
  {
    label: 'TBD',
    pattern: /^\s*(?:[-*]\s*)?TBD\s*:/i,
  },
] as const

export const isOpenPrdIssue = (issue: GitHubIssue): boolean =>
  issue.state === 'OPEN' && issue.title.startsWith(prdTitlePrefix)

export const parseChildTaskIssue = (issue: GitHubIssue): ParsedChildTask => {
  const sections = parseMarkdownSections(issue.body)
  const parentPrdNumber = parseParentPrdNumber(sections)

  if (parentPrdNumber === undefined) {
    throw new Error(`${formatIssueReference(issue.number)} does not reference a parent PRD`)
  }

  const acceptanceCriteria = parseAcceptanceCriteria(
    getSectionContent(sections, 'Acceptance criteria'),
  )

  return {
    acceptanceCriteria,
    blockedBy: parseIssueReferences(getSectionContent(sections, 'Blocked by')),
    hitlMarkers: detectHitlMarkers(issue.body),
    issueNumber: issue.number,
    parentPrdNumber,
    title: issue.title,
    userStoriesAddressed: parseUserStoryReferences(
      getSectionContent(sections, 'User stories addressed'),
    ),
    whatToBuild: getSectionContent(sections, 'What to build').trim(),
  }
}

export const createDryRunPlan = (issues: readonly GitHubIssue[]): DryRunPlan => {
  const childTasks = issues
    .filter((issue) => !isOpenPrdIssue(issue) && issue.state === 'OPEN')
    .flatMap((issue) => parseOptionalChildTask(issue))
  const prdIssues = issues.filter((issue) => isOpenPrdIssue(issue)).toSorted(compareIssuesByNumber)
  const unavailablePrds = prdIssues
    .filter((prdIssue) =>
      childTasks.every((childTask) => childTask.parentPrdNumber !== prdIssue.number),
    )
    .map((prdIssue) => ({
      issueNumber: prdIssue.number,
      reason: 'PRD has no child issues',
    }))
  const selectedPrdIssue = prdIssues.find((prdIssue) =>
    childTasks.some((childTask) => childTask.parentPrdNumber === prdIssue.number),
  )

  if (selectedPrdIssue === undefined) {
    return {
      selectedPrd: undefined,
      unavailablePrds,
    }
  }

  const selectedChildren = childTasks
    .filter((childTask) => childTask.parentPrdNumber === selectedPrdIssue.number)
    .toSorted(compareChildTasksByIssueNumber)
  const dependencyValidation = validateDependencies(selectedChildren)
  const blockers = [
    ...validateChildTasks(selectedChildren),
    ...dependencyValidation.blockers,
    ...validateUserStoryCoverage(selectedPrdIssue, selectedChildren),
  ]

  return {
    selectedPrd: {
      blockers,
      childTaskDag: dependencyValidation.dag,
      childTasks: selectedChildren,
      issueNumber: selectedPrdIssue.number,
      nextExecutableTasks: findNextExecutableTasks(dependencyValidation.dag),
      title: selectedPrdIssue.title,
      warnings: collectDecisionCoverageWarnings(selectedPrdIssue),
    },
    unavailablePrds,
  }
}

export const renderDryRunPlan = (plan: DryRunPlan): string => {
  const unavailablePrdLines = plan.unavailablePrds.map(
    (prd) => `- ${formatIssueReference(prd.issueNumber)}: ${prd.reason}`,
  )

  if (plan.selectedPrd === undefined) {
    return [
      'PRD Orchestrator Plan',
      'Writes: none',
      'Selected PRD: none',
      formatList('Unavailable PRDs', unavailablePrdLines),
    ].join('\n')
  }

  const selectedPrd = plan.selectedPrd
  const dagLines = selectedPrd.childTaskDag.map((node) => {
    const dependencies =
      node.dependencies.length === 0
        ? 'no dependencies'
        : `after ${formatIssueReferences(node.dependencies)}`

    return `- ${formatIssueReference(node.issueNumber)}: ${dependencies}`
  })

  return [
    'PRD Orchestrator Plan',
    'Writes: none',
    `Selected PRD: ${formatIssueReference(selectedPrd.issueNumber)} ${selectedPrd.title}`,
    formatList('Child task DAG', dagLines),
    formatList('Blockers', selectedPrd.blockers),
    formatList('Warnings', selectedPrd.warnings),
    `Next executable tasks: ${formatIssueReferences(selectedPrd.nextExecutableTasks)}`,
    formatList('Unavailable PRDs', unavailablePrdLines),
  ].join('\n')
}

const parseOptionalChildTask = (issue: GitHubIssue): readonly ParsedChildTask[] => {
  const sections = parseMarkdownSections(issue.body)

  if (parseParentPrdNumber(sections) === undefined) {
    return []
  }

  return [parseChildTaskIssue(issue)]
}

const parseMarkdownSections = (body: string): readonly MarkdownSection[] => {
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)]

  return headings.map((heading, index) => {
    const nextHeading = headings.at(index + 1)
    const contentStart = heading.index + heading[0].length
    const contentEnd = nextHeading?.index ?? body.length
    const title = heading[1] ?? ''

    return {
      content: body.slice(contentStart, contentEnd).trim(),
      title,
    }
  })
}

const getSectionContent = (sections: readonly MarkdownSection[], title: string): string =>
  sections.find((section) => normaliseHeading(section.title) === normaliseHeading(title))
    ?.content ?? ''

const normaliseHeading = (heading: string): string => heading.trim().toLowerCase()

const parseParentPrdNumber = (sections: readonly MarkdownSection[]): number | undefined =>
  parseIssueReferences(getSectionContent(sections, 'Parent PRD')).at(0)

const parseIssueReferences = (content: string): readonly number[] => [
  ...new Set(
    [...content.matchAll(/#(\d+)/g)]
      .map((match) => Number.parseInt(match[1] ?? '', 10))
      .filter((issueNumber) => Number.isInteger(issueNumber)),
  ),
]

const parseAcceptanceCriteria = (content: string): readonly string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const checkboxMatch = /^[-*]\s+\[[ xX]\]\s+(.+)$/.exec(line)

      if (checkboxMatch?.[1] !== undefined) {
        return [checkboxMatch[1].trim()]
      }

      const bulletMatch = /^[-*]\s+(.+)$/.exec(line)

      if (bulletMatch?.[1] !== undefined) {
        return [bulletMatch[1].trim()]
      }

      return []
    })

const parseUserStoryReferences = (content: string): readonly number[] => [
  ...new Set(
    [...content.matchAll(/User story\s+(\d+)/gi)]
      .map((match) => Number.parseInt(match[1] ?? '', 10))
      .filter((storyNumber) => Number.isInteger(storyNumber)),
  ),
]

const detectHitlMarkers = (content: string): readonly string[] =>
  hitlMarkerPatterns
    .filter((marker) => content.split('\n').some((line) => marker.pattern.test(line)))
    .map((marker) => marker.label)

const validateChildTasks = (childTasks: readonly ParsedChildTask[]): readonly string[] =>
  childTasks.flatMap((childTask) => {
    const acceptanceBlockers =
      childTask.acceptanceCriteria.length === 0
        ? [`${formatIssueReference(childTask.issueNumber)} has no acceptance criteria`]
        : []
    const hitlBlockers =
      childTask.hitlMarkers.length === 0
        ? []
        : [
            `${formatIssueReference(
              childTask.issueNumber,
            )} contains HITL/unresolved-decision markers`,
          ]

    return [...acceptanceBlockers, ...hitlBlockers]
  })

const validateUserStoryCoverage = (
  prdIssue: GitHubIssue,
  childTasks: readonly ParsedChildTask[],
): readonly string[] => {
  const parentStories = parseParentUserStories(prdIssue.body)
  const childStories = new Set(
    childTasks.flatMap((childTask) => [...childTask.userStoriesAddressed]),
  )

  return parentStories
    .filter((storyNumber) => !childStories.has(storyNumber))
    .map((storyNumber) => `User story ${String(storyNumber)} is not covered by child tasks`)
}

const parseParentUserStories = (body: string): readonly number[] =>
  [
    ...new Set([
      ...parseUserStoryReferences(getSectionContent(parseMarkdownSections(body), 'User Stories')),
      ...parseNumberedUserStories(getSectionContent(parseMarkdownSections(body), 'User Stories')),
    ]),
  ].toSorted(compareNumbers)

const parseNumberedUserStories = (content: string): readonly number[] =>
  content
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\.\s+/.exec(line)

      if (match?.[1] === undefined) {
        return []
      }

      return [Number.parseInt(match[1], 10)]
    })
    .filter((storyNumber) => Number.isInteger(storyNumber))

const validateDependencies = (childTasks: readonly ParsedChildTask[]): DependencyValidation => {
  const childIssueNumbers = new Set(childTasks.map((childTask) => childTask.issueNumber))
  const unknownDependencyBlockers = childTasks.flatMap((childTask) =>
    childTask.blockedBy
      .filter((dependency) => !childIssueNumbers.has(dependency))
      .map(
        (dependency) =>
          `${formatIssueReference(
            childTask.issueNumber,
          )} depends on unknown child issue ${formatIssueReference(dependency)}`,
      ),
  )
  const validDependencies = childTasks.map((childTask) => ({
    dependencies: childTask.blockedBy
      .filter((dependency) => childIssueNumbers.has(dependency))
      .toSorted(compareNumbers),
    issueNumber: childTask.issueNumber,
  }))
  const orderedDag = topologicallySort(validDependencies)
  const cycleBlockers =
    orderedDag.length === validDependencies.length
      ? []
      : ['Child task dependencies contain a cycle']

  return {
    blockers: [...unknownDependencyBlockers, ...cycleBlockers],
    dag: orderedDag.length === validDependencies.length ? orderedDag : validDependencies,
  }
}

const topologicallySort = (dag: readonly ChildTaskDagNode[]): readonly ChildTaskDagNode[] => {
  const nodesByIssueNumber = new Map(
    dag.map((node) => [
      node.issueNumber,
      {
        dependencies: [...node.dependencies],
        issueNumber: node.issueNumber,
      },
    ]),
  )
  const remainingDependencyCounts = new Map(
    dag.map((node) => [node.issueNumber, node.dependencies.length]),
  )
  const dependentsByIssueNumber = new Map<number, number[]>()

  for (const node of dag) {
    for (const dependency of node.dependencies) {
      dependentsByIssueNumber.set(dependency, [
        ...(dependentsByIssueNumber.get(dependency) ?? []),
        node.issueNumber,
      ])
    }
  }

  const readyIssueNumbers = dag
    .filter((node) => node.dependencies.length === 0)
    .map((node) => node.issueNumber)
    .toSorted(compareNumbers)
  const orderedNodes: ChildTaskDagNode[] = []

  while (readyIssueNumbers.length > 0) {
    const issueNumber = readyIssueNumbers.shift()

    if (issueNumber === undefined) {
      continue
    }

    const node = nodesByIssueNumber.get(issueNumber)

    if (node === undefined) {
      continue
    }

    orderedNodes.push(node)

    const dependentIssueNumbers = [...(dependentsByIssueNumber.get(issueNumber) ?? [])].toSorted(
      compareNumbers,
    )

    for (const dependentIssueNumber of dependentIssueNumbers) {
      const remainingDependencyCount =
        (remainingDependencyCounts.get(dependentIssueNumber) ?? 0) - 1
      remainingDependencyCounts.set(dependentIssueNumber, remainingDependencyCount)

      if (remainingDependencyCount === 0) {
        readyIssueNumbers.push(dependentIssueNumber)
        readyIssueNumbers.sort(compareNumbers)
      }
    }
  }

  return orderedNodes
}

const findNextExecutableTasks = (dag: readonly ChildTaskDagNode[]): readonly number[] =>
  dag
    .filter((node) => node.dependencies.length === 0)
    .map((node) => node.issueNumber)
    .toSorted(compareNumbers)

const collectDecisionCoverageWarnings = (prdIssue: GitHubIssue): readonly string[] => {
  const sections = parseMarkdownSections(prdIssue.body)
  const hasImplementationDecisions =
    getSectionContent(sections, 'Implementation Decisions').length > 0
  const hasTestingDecisions = getSectionContent(sections, 'Testing Decisions').length > 0

  if (!hasImplementationDecisions && !hasTestingDecisions) {
    return []
  }

  return ['Parent implementation/testing decisions require manual coverage review']
}

const formatList = (title: string, lines: readonly string[]): string =>
  lines.length === 0 ? `${title}: none` : [title, ...lines].join('\n')

const formatIssueReferences = (issueNumbers: readonly number[]): string =>
  issueNumbers.length === 0
    ? 'none'
    : issueNumbers.map((issueNumber) => formatIssueReference(issueNumber)).join(', ')

const formatIssueReference = (issueNumber: number): string => `#${String(issueNumber)}`

const compareIssuesByNumber = (left: GitHubIssue, right: GitHubIssue): number =>
  compareNumbers(left.number, right.number)

const compareChildTasksByIssueNumber = (left: ParsedChildTask, right: ParsedChildTask): number =>
  compareNumbers(left.issueNumber, right.issueNumber)

const compareNumbers = (left: number, right: number): number => left - right
