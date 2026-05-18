import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  assessEnglishLanguageSupport,
  ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
} from '../shared/language-support.js';
import type {
  OriginalCvDetail,
  OriginalCvFileType,
  OriginalCvImportErrorCode,
  OriginalCvPreview,
  OriginalCvProfile,
  OriginalCvSummary,
  OriginalCvWorkspaceState,
  OriginalCvWritingStyle,
} from '../shared/original-cv.js';
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js';
import { OriginalCvNormalizationError } from './original-cv-normalization-error.js';
import type {
  NormalizedOriginalCv,
  OriginalCvNormalizationService,
} from './original-cv-normalization-service.js';

const ORIGINAL_CV_SCOPE = 'original-cvs';
const INVALID_NORMALIZATION_MESSAGE =
  "We couldn't make sense of this CV. Try a clearer PDF or DOCX.";
const NORMALIZATION_TIMEOUT_MESSAGE = 'Adding this CV took too long. Try again.';
const UNREADABLE_EXTRACTION_MESSAGE =
  "We couldn't read enough from this CV. Use a text-based PDF or DOCX.";
const SKILL_GROUNDING_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
]);

interface ExtractedDocumentText {
  pageCount: number;
  text: string;
}

interface StoredOriginalCvRecord extends OriginalCvSummary {
  checksum: string;
  extractedText: string;
  fullName: string;
  isActive: boolean;
}

interface OriginalCvServiceDependencies {
  extractTextFromDocx: (content: Buffer) => Promise<ExtractedDocumentText>;
  extractTextFromPdf: (content: Buffer) => Promise<ExtractedDocumentText>;
  generateId?: () => string;
  getCurrentTimestamp?: () => string;
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;
  normalizationService: OriginalCvNormalizationService;
}

export interface ImportOriginalCvInput {
  content: Buffer;
  filename: string;
}

export interface OriginalCvService {
  getActiveOriginalCvDetail: () => Promise<OriginalCvDetail | null>;
  getWorkspaceState: () => Promise<OriginalCvWorkspaceState>;
  importOriginalCv: (input: ImportOriginalCvInput) => Promise<OriginalCvSummary>;
}

interface OriginalCvMetadataValue extends Record<string, JsonValue> {
  checksum: string;
  extractedText: string;
  fileType: OriginalCvFileType;
  fullName: string;
  headline: string;
  id: string;
  importedAt: string;
  isActive: boolean;
  originalFilename: string;
  pageCount: number;
  summary: string;
  writingStyle: {
    averageSentenceLength: number;
    clicheDetections: string[];
    firstPersonUsage: OriginalCvWritingStyle['firstPersonUsage'];
    formality: OriginalCvWritingStyle['formality'];
  };
}

export class OriginalCvImportError extends Error {
  readonly code: OriginalCvImportErrorCode;

  override name = 'OriginalCvImportError';

  constructor({ code, message }: { code: OriginalCvImportErrorCode; message: string }) {
    super(message);
    this.code = code;
  }
}

export function createOriginalCvService({
  extractTextFromDocx,
  extractTextFromPdf,
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString();
  },
  localAppData,
  normalizationService,
}: OriginalCvServiceDependencies): OriginalCvService {
  return {
    getActiveOriginalCvDetail: async (): Promise<OriginalCvDetail | null> => {
      const storedRecords = await listStoredRecords(localAppData);
      const activeRecord = storedRecords.find((record) => {
        return record.isActive;
      });

      if (activeRecord === undefined) {
        return null;
      }

      const originalCv = toOriginalCvSummary(activeRecord, storedRecords.length);
      const [preview, profile] = await Promise.all([
        readOriginalCvPreview({
          fileType: activeRecord.fileType,
          id: activeRecord.id,
          localAppData,
          pageCount: activeRecord.pageCount,
        }),
        readOriginalCvProfile({
          id: activeRecord.id,
          localAppData,
        }),
      ]);

      if (profile === null) {
        return null;
      }

      return {
        originalCv,
        preview,
        profile,
      };
    },
    getWorkspaceState: async (): Promise<OriginalCvWorkspaceState> => {
      const storedRecords = await listStoredRecords(localAppData);
      const activeRecord = storedRecords.find((record) => {
        return record.isActive;
      });

      return {
        activeOriginalCv: activeRecord
          ? toOriginalCvSummary(activeRecord, storedRecords.length)
          : null,
        snapshotCount: storedRecords.length,
      };
    },
    importOriginalCv: async ({
      content,
      filename,
    }: ImportOriginalCvInput): Promise<OriginalCvSummary> => {
      const fileType = getOriginalCvFileType(filename);
      const extractedDocument =
        fileType === 'pdf' ? await extractTextFromPdf(content) : await extractTextFromDocx(content);

      if (!isReadableExtraction(extractedDocument.text)) {
        throw new OriginalCvImportError({
          code: 'unreadable_extraction',
          message: UNREADABLE_EXTRACTION_MESSAGE,
        });
      }

      if (assessEnglishLanguageSupport(extractedDocument.text).status === 'blocked') {
        throw new OriginalCvImportError({
          code: 'unsupported_language',
          message: ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
        });
      }

      let normalizedCv: NormalizedOriginalCv;
      let writingStyle: OriginalCvWritingStyle;

      try {
        const normalizationResult = await normalizationService.normalizeOriginalCv({
          extractedText: extractedDocument.text,
          fileType,
          originalFilename: filename,
          pageCount: extractedDocument.pageCount,
        });

        normalizedCv = normalizationResult.normalizedCv;
        writingStyle = normalizationResult.writingStyle;
      } catch (error) {
        if (error instanceof OriginalCvNormalizationError) {
          throw new OriginalCvImportError({
            code: 'invalid_normalization',
            message:
              error.code === 'timeout'
                ? NORMALIZATION_TIMEOUT_MESSAGE
                : INVALID_NORMALIZATION_MESSAGE,
          });
        }

        throw error;
      }

      validateNormalizedOriginalCv({
        extractedText: extractedDocument.text,
        normalizedCv,
      });
      const importedAt = getCurrentTimestamp();
      const id = generateId();
      const checksum = createHash('sha256').update(content).digest('hex');
      const existingRecords = await listStoredRecords(localAppData);
      const nextSnapshotCount = existingRecords.length + 1;

      await deactivateExistingOriginalCvs({
        localAppData,
        records: existingRecords,
      });
      await persistOriginalCvArtifacts({
        content,
        extractedText: extractedDocument.text,
        fileType,
        id,
        localAppData,
        normalizedCv,
        writingStyle,
      });

      const storedRecord: StoredOriginalCvRecord = {
        checksum,
        extractedText: extractedDocument.text,
        fileType,
        fullName: normalizedCv.fullName,
        headline: normalizedCv.headline,
        id,
        importedAt,
        isActive: true,
        originalFilename: filename,
        pageCount: extractedDocument.pageCount,
        snapshotCount: nextSnapshotCount,
        summary: normalizedCv.summary,
        writingStyle,
      };

      await localAppData.metadata.put({
        id,
        scope: ORIGINAL_CV_SCOPE,
        value: toOriginalCvMetadataValue(storedRecord),
      });

      return toOriginalCvSummary(storedRecord, nextSnapshotCount);
    },
  };
}

async function readOriginalCvProfile({
  id,
  localAppData,
}: {
  id: string;
  localAppData: Pick<LocalAppDataStore, 'artifacts'>;
}): Promise<OriginalCvProfile | null> {
  const artifact = await localAppData.artifacts.read({
    id,
    name: 'normalized.json',
    scope: ORIGINAL_CV_SCOPE,
  });

  if (artifact === null) {
    return null;
  }

  try {
    return parseOriginalCvProfile(JSON.parse(artifact.toString('utf8')) as unknown);
  } catch {
    return null;
  }
}

async function readOriginalCvPreview({
  fileType,
  id,
  localAppData,
  pageCount,
}: {
  fileType: OriginalCvFileType;
  id: string;
  localAppData: Pick<LocalAppDataStore, 'artifacts'>;
  pageCount: number;
}): Promise<OriginalCvPreview | null> {
  const artifactName = fileType === 'pdf' ? 'source.pdf' : 'source.docx';

  const artifact = await localAppData.artifacts.read({
    id,
    name: artifactName,
    scope: ORIGINAL_CV_SCOPE,
  });

  if (artifact === null) {
    return null;
  }

  if (fileType === 'pdf') {
    return {
      kind: 'pdf',
      pageCount,
      pdfBytes: new Uint8Array(artifact),
    };
  }

  return {
    docxBytes: new Uint8Array(artifact),
    kind: 'docx',
  };
}

async function deactivateExistingOriginalCvs({
  localAppData,
  records,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>;
  records: StoredOriginalCvRecord[];
}): Promise<void> {
  await Promise.all(
    records
      .filter((record) => {
        return record.isActive;
      })
      .map(async (record) => {
        await localAppData.metadata.put({
          id: record.id,
          scope: ORIGINAL_CV_SCOPE,
          value: toOriginalCvMetadataValue({
            ...record,
            isActive: false,
          }),
        });
      }),
  );
}

async function persistOriginalCvArtifacts({
  content,
  extractedText,
  fileType,
  id,
  localAppData,
  normalizedCv,
  writingStyle,
}: {
  content: Buffer;
  extractedText: string;
  fileType: OriginalCvFileType;
  id: string;
  localAppData: Pick<LocalAppDataStore, 'artifacts'>;
  normalizedCv: NormalizedOriginalCv;
  writingStyle: OriginalCvWritingStyle;
}): Promise<void> {
  await localAppData.artifacts.write({
    content,
    id,
    name: `source.${fileType}`,
    scope: ORIGINAL_CV_SCOPE,
  });
  await localAppData.artifacts.write({
    content: Buffer.from(extractedText, 'utf8'),
    id,
    name: 'extracted.txt',
    scope: ORIGINAL_CV_SCOPE,
  });
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(normalizedCv), 'utf8'),
    id,
    name: 'normalized.json',
    scope: ORIGINAL_CV_SCOPE,
  });
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(writingStyle), 'utf8'),
    id,
    name: 'writing-style-profile.json',
    scope: ORIGINAL_CV_SCOPE,
  });
}

async function listStoredRecords(
  localAppData: Pick<LocalAppDataStore, 'metadata'>,
): Promise<StoredOriginalCvRecord[]> {
  const records = await localAppData.metadata.list<OriginalCvMetadataValue>(ORIGINAL_CV_SCOPE);

  return records
    .map((record) => {
      return fromOriginalCvMetadataValue(record.value);
    })
    .toSorted((leftRecord, rightRecord) => {
      return leftRecord.importedAt.localeCompare(rightRecord.importedAt);
    });
}

function fromOriginalCvMetadataValue(value: OriginalCvMetadataValue): StoredOriginalCvRecord {
  return {
    checksum: value.checksum,
    extractedText: value.extractedText,
    fileType: value.fileType,
    fullName: value.fullName,
    headline: value.headline,
    id: value.id,
    importedAt: value.importedAt,
    isActive: value.isActive,
    originalFilename: value.originalFilename,
    pageCount: value.pageCount,
    snapshotCount: 0,
    summary: value.summary,
    writingStyle: value.writingStyle,
  };
}

function toOriginalCvMetadataValue(record: StoredOriginalCvRecord): OriginalCvMetadataValue {
  return {
    checksum: record.checksum,
    extractedText: record.extractedText,
    fileType: record.fileType,
    fullName: record.fullName,
    headline: record.headline,
    id: record.id,
    importedAt: record.importedAt,
    isActive: record.isActive,
    originalFilename: record.originalFilename,
    pageCount: record.pageCount,
    summary: record.summary,
    writingStyle: {
      averageSentenceLength: record.writingStyle.averageSentenceLength,
      clicheDetections: record.writingStyle.clicheDetections,
      firstPersonUsage: record.writingStyle.firstPersonUsage,
      formality: record.writingStyle.formality,
    },
  };
}

function toOriginalCvSummary(
  record: StoredOriginalCvRecord,
  snapshotCount: number,
): OriginalCvSummary {
  return {
    fileType: record.fileType,
    headline: record.headline,
    id: record.id,
    importedAt: record.importedAt,
    originalFilename: record.originalFilename,
    pageCount: record.pageCount,
    snapshotCount,
    summary: record.summary,
    writingStyle: record.writingStyle,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOriginalCvProfile(value: unknown): OriginalCvProfile | null {
  if (
    !isRecord(value) ||
    !isRecord(value.contact) ||
    !Array.isArray(value.experience) ||
    typeof value.fullName !== 'string' ||
    typeof value.headline !== 'string' ||
    !Array.isArray(value.skills) ||
    typeof value.summary !== 'string'
  ) {
    return null;
  }

  const experience = value.experience.map((entry) => {
    return parseOriginalCvExperienceEntry(entry);
  });
  const skills = value.skills.filter((skill): skill is string => {
    return typeof skill === 'string';
  });
  const contact = parseOriginalCvContact(value.contact);

  if (contact === null || experience.includes(null) || skills.length !== value.skills.length) {
    return null;
  }

  return {
    contact,
    experience: experience.filter((entry): entry is OriginalCvProfile['experience'][number] => {
      return entry !== null;
    }),
    fullName: value.fullName,
    headline: value.headline,
    skills,
    summary: value.summary,
  };
}

function parseOriginalCvContact(value: unknown): OriginalCvProfile['contact'] | null {
  if (
    !isRecord(value) ||
    typeof value.email !== 'string' ||
    typeof value.location !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.professionalLink !== 'string'
  ) {
    return null;
  }

  return {
    email: value.email,
    location: value.location,
    phone: value.phone,
    professionalLink: value.professionalLink,
  };
}

function parseOriginalCvExperienceEntry(
  value: unknown,
): OriginalCvProfile['experience'][number] | null {
  if (
    !isRecord(value) ||
    typeof value.dateRange !== 'string' ||
    typeof value.employer !== 'string' ||
    typeof value.roleTitle !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    dateRange: value.dateRange,
    employer: value.employer,
    roleTitle: value.roleTitle,
    summary: value.summary,
  };
}

function getOriginalCvFileType(filename: string): OriginalCvFileType {
  const extension = path.extname(filename).toLowerCase();

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (extension === '.docx') {
    return 'docx';
  }

  throw new OriginalCvImportError({
    code: 'unsupported_file_type',
    message: 'Original CV import supports PDF and DOCX files only.',
  });
}

function isReadableExtraction(extractedText: string) {
  const trimmedText = extractedText.trim();
  const letters = trimmedText.match(/[a-z]/giu)?.length ?? 0;
  const alphaRatio = trimmedText.length === 0 ? 0 : letters / trimmedText.length;

  return trimmedText.length >= 80 && alphaRatio >= 0.45;
}

function validateNormalizedOriginalCv({
  extractedText,
  normalizedCv,
}: {
  extractedText: string;
  normalizedCv: NormalizedOriginalCv;
}) {
  const hasReadableIdentity =
    countWords(normalizedCv.fullName) >= 2 || countWords(normalizedCv.headline) >= 2;
  const hasSubstantiveExperience = normalizedCv.experience.some((entry) => {
    return countWords(`${entry.roleTitle} ${entry.employer} ${entry.summary}`) >= 4;
  });
  const hasSubstantiveSkills = normalizedCv.skills.length >= 3;

  if (!hasReadableIdentity || (!hasSubstantiveExperience && !hasSubstantiveSkills)) {
    throw new OriginalCvImportError({
      code: 'weak_normalization',
      message: INVALID_NORMALIZATION_MESSAGE,
    });
  }

  validateGroundedHighRiskFields({
    extractedText,
    normalizedCv,
  });
}

function validateGroundedHighRiskFields({
  extractedText,
  normalizedCv,
}: {
  extractedText: string;
  normalizedCv: NormalizedOriginalCv;
}) {
  if (!isGroundedIdentityFieldInSource(normalizedCv.fullName, extractedText)) {
    throwUnsupportedGroundingError();
  }

  if (!isGroundedIdentityFieldInSource(normalizedCv.headline, extractedText)) {
    throwUnsupportedGroundingError();
  }

  for (const skill of normalizedCv.skills) {
    if (!isGroundedSkillInSource(skill, extractedText)) {
      throwUnsupportedGroundingError();
    }
  }

  normalizedCv.contact = sanitizeGroundedContactFields(normalizedCv.contact, extractedText);
}

function isGroundedIdentityFieldInSource(value: string, extractedText: string) {
  const normalizedValue = normalizeGroundingText(value);

  if (normalizedValue === '') {
    return true;
  }

  const normalizedSource = normalizeGroundingText(extractedText);

  return normalizedSource.includes(normalizedValue);
}

function isGroundedSkillInSource(skill: string, extractedText: string) {
  const normalizedSkill = normalizeGroundingText(skill);

  if (normalizedSkill === '') {
    return true;
  }

  const evidenceCandidates = createSkillEvidenceCandidates(extractedText);

  if (
    evidenceCandidates.some((candidate) => {
      return candidate.includes(normalizedSkill);
    })
  ) {
    return true;
  }

  const skillTokens = getMeaningfulSkillTokens(normalizedSkill);

  if (skillTokens.length === 0) {
    return true;
  }

  return evidenceCandidates.some((candidate) => {
    const candidateTokens = candidate.split(' ').filter((token) => {
      return token !== '';
    });

    return skillTokens.every((skillToken) => {
      return candidateTokens.some((candidateToken) => {
        return groundingTokensMatch(skillToken, candidateToken);
      });
    });
  });
}

function isGroundedTextFieldInSource(value: string, extractedText: string) {
  const trimmedValue = value.trim();

  if (trimmedValue === '') {
    return true;
  }

  if (extractedText.includes(trimmedValue)) {
    return true;
  }

  const normalizedValue = normalizeGroundingText(trimmedValue);

  if (normalizedValue === '') {
    return true;
  }

  return normalizeGroundingText(extractedText).includes(normalizedValue);
}

function sanitizeGroundedContactFields(
  contact: NormalizedOriginalCv['contact'],
  extractedText: string,
): NormalizedOriginalCv['contact'] {
  return {
    email: isGroundedEmailInSource(contact.email, extractedText) ? contact.email : '',
    location: isGroundedLocationFieldInSource(contact.location, extractedText)
      ? contact.location
      : '',
    phone: isGroundedPhoneInSource(contact.phone, extractedText) ? contact.phone : '',
    professionalLink: resolvePrioritizedProfessionalLink(contact.professionalLink, extractedText),
  };
}

function isGroundedEmailInSource(value: string, extractedText: string) {
  const trimmedValue = value.trim().toLowerCase();

  if (trimmedValue === '') {
    return true;
  }

  if (!trimmedValue.includes('@')) {
    return false;
  }

  return extractedText.toLowerCase().includes(trimmedValue);
}

function isGroundedLocationFieldInSource(value: string, extractedText: string) {
  if (isGroundedTextFieldInSource(value, extractedText)) {
    return true;
  }

  const locationSegments = value
    .split(',')
    .map((segment) => {
      return segment.trim();
    })
    .filter((segment) => {
      return segment !== '';
    });

  if (locationSegments.length < 2) {
    return false;
  }

  const groundedLocationCore = locationSegments.slice(0, -1).join(', ');

  return isGroundedTextFieldInSource(groundedLocationCore, extractedText);
}

function isGroundedPhoneInSource(value: string, extractedText: string) {
  const canonicalPhone = canonicalizePhoneForGrounding(value);

  if (canonicalPhone === '') {
    return true;
  }

  return canonicalizePhoneForGrounding(extractedText).includes(canonicalPhone);
}

function isGroundedProfessionalLinkInSource(value: string, extractedText: string) {
  const trimmedValue = value.trim().toLowerCase();

  if (trimmedValue === '') {
    return true;
  }

  if (extractedText.toLowerCase().includes(trimmedValue)) {
    return true;
  }

  const canonicalValue = canonicalizeProfessionalLinkForGrounding(trimmedValue);

  if (canonicalValue === '') {
    return false;
  }

  return canonicalizeProfessionalLinkForGrounding(extractedText).includes(canonicalValue);
}

function resolvePrioritizedProfessionalLink(value: string, extractedText: string) {
  const sourceCandidates = extractProfessionalLinkCandidates(extractedText);

  if (sourceCandidates.length > 0) {
    return (
      sourceCandidates.toSorted((leftCandidate, rightCandidate) => {
        return rightCandidate.priority - leftCandidate.priority;
      })[0]?.value ?? ''
    );
  }

  return isGroundedProfessionalLinkInSource(value, extractedText) ? value : '';
}

function extractProfessionalLinkCandidates(extractedText: string): {
  priority: number;
  value: string;
}[] {
  const uniqueCandidates = new Map<
    string,
    {
      priority: number;
      value: string;
    }
  >();
  const candidatePattern =
    /(?<!@)\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/[^\s<>()]+|github\.com\/[^\s<>()]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>()]+)?)\b/giu;

  for (const line of extractedText.split(/\r?\n/gu)) {
    const matches = [...line.matchAll(candidatePattern)].map((match) => {
      return match[0];
    });

    for (const match of matches) {
      const trimmedMatch = match.trim().replaceAll(/[.,;:!?]+$/gu, '');

      if (trimmedMatch === '' || trimmedMatch.includes('@')) {
        continue;
      }

      const priority = getProfessionalLinkPriority(trimmedMatch);

      if (priority === null || !isProfessionalLinkCandidateGroundedInLine(trimmedMatch, line)) {
        continue;
      }

      const canonicalValue = canonicalizeProfessionalLinkForGrounding(trimmedMatch);

      if (canonicalValue === '') {
        continue;
      }

      uniqueCandidates.set(canonicalValue, {
        priority,
        value: trimmedMatch,
      });
    }
  }

  return [...uniqueCandidates.values()];
}

function isProfessionalLinkCandidateGroundedInLine(candidate: string, line: string) {
  const trimmedLine = line.trim();

  if (trimmedLine === '') {
    return false;
  }

  const canonicalValue = canonicalizeProfessionalLinkForGrounding(candidate);

  if (canonicalValue.includes('linkedin.com/') || canonicalValue.includes('github.com/')) {
    return true;
  }

  return (
    trimmedLine === candidate || (trimmedLine.endsWith(candidate) && countWords(trimmedLine) <= 3)
  );
}

function getProfessionalLinkPriority(value: string): number | null {
  const canonicalValue = canonicalizeProfessionalLinkForGrounding(value);

  if (canonicalValue === '') {
    return null;
  }

  if (canonicalValue.includes('linkedin.com/')) {
    return 2;
  }

  if (canonicalValue.includes('github.com/')) {
    return 1;
  }

  if (canonicalValue.includes('.')) {
    return 3;
  }

  return null;
}

function canonicalizePhoneForGrounding(value: string) {
  return value.replaceAll(/\D+/gu, '');
}

function canonicalizeProfessionalLinkForGrounding(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/https?:\/\//gu, '')
    .replaceAll(/\bwww\./gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function createSkillEvidenceCandidates(extractedText: string): string[] {
  const normalizedLines = extractedText
    .split(/\r?\n/u)
    .map((line) => {
      return normalizeGroundingText(line);
    })
    .filter((line) => {
      return line !== '';
    });

  const adjacentLinePairs = normalizedLines.slice(0, -1).map((line, index) => {
    return `${line} ${normalizedLines[index + 1] ?? ''}`.trim();
  });

  return [...new Set([...normalizedLines, ...adjacentLinePairs])];
}

function getMeaningfulSkillTokens(skill: string): string[] {
  return skill.split(' ').filter((token) => {
    return token !== '' && !SKILL_GROUNDING_STOP_WORDS.has(token);
  });
}

function groundingTokensMatch(skillToken: string, candidateToken: string) {
  if (skillToken === candidateToken) {
    return true;
  }

  const [shorterToken, longerToken] =
    skillToken.length <= candidateToken.length
      ? [skillToken, candidateToken]
      : [candidateToken, skillToken];

  if (shorterToken.length < 5) {
    return false;
  }

  return longerToken.startsWith(shorterToken);
}

function normalizeGroundingText(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}#+]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ');
}

function throwUnsupportedGroundingError() {
  throw new OriginalCvImportError({
    code: 'weak_normalization',
    message: INVALID_NORMALIZATION_MESSAGE,
  });
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/u)
    .filter((word) => {
      return word !== '';
    }).length;
}
