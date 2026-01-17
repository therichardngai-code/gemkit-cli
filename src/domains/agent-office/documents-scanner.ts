import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { PlanDocument, DocumentType } from './types.js';
import { createHash } from 'crypto';

/**
 * Get icon for document type/extension
 */
function getDocumentIcon(type: DocumentType, ext: string): string {
  const typeIcons: Record<DocumentType, string> = {
    plan: '\uD83D\uDCCB',      // clipboard
    phase: '\uD83D\uDCD1',     // bookmark tabs
    research: '\uD83D\uDD0D',  // magnifier
    artifact: '\uD83D\uDCE6',  // package
    report: '\uD83D\uDCCA',    // chart
    other: '\uD83D\uDCC4',     // document
  };

  if (type === 'artifact') {
    const extIcons: Record<string, string> = {
      sql: '\uD83D\uDDC4\uFE0F',  // file cabinet
      json: '\uD83D\uDCE6',       // package
      png: '\uD83D\uDDBC\uFE0F',  // frame
      jpg: '\uD83D\uDDBC\uFE0F',  // frame
      ts: '\uD83D\uDCBB',         // laptop
      js: '\uD83D\uDCBB',         // laptop
    };
    return extIcons[ext] || typeIcons.artifact;
  }

  return typeIcons[type];
}

/**
 * Extract phase number from filename
 */
function extractPhaseNumber(name: string): number | null {
  const match = name.match(/^phase-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Format document name for display
 */
function formatDocumentName(name: string, type: DocumentType): string {
  if (type === 'phase') {
    const num = extractPhaseNumber(name);
    const rest = name.replace(/^phase-\d+-?/, '').replace(/-/g, ' ');
    return num !== null ? `Phase ${num}: ${rest}` : name;
  }
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Create document object from file path
 */
function createDocument(
  filePath: string,
  type: DocumentType,
  planPath: string
): PlanDocument {
  const stat = statSync(filePath);
  const name = basename(filePath, extname(filePath));
  const ext = extname(filePath).slice(1);

  return {
    id: createHash('md5').update(filePath).digest('hex').slice(0, 8),
    name,
    displayName: formatDocumentName(name, type),
    type,
    icon: getDocumentIcon(type, ext),
    path: filePath,
    relativePath: relative(planPath, filePath),
    modifiedAt: stat.mtimeMs,
    createdAt: stat.birthtimeMs,
    size: stat.size,
    extension: ext,
    phaseNumber: extractPhaseNumber(name),
  };
}

/**
 * Scan plan folder for documents
 */
export function scanPlanDocuments(planPath: string): PlanDocument[] {
  if (!existsSync(planPath)) return [];

  const documents: PlanDocument[] = [];

  // 1. Scan plan.md (main plan)
  const planFile = join(planPath, 'plan.md');
  if (existsSync(planFile)) {
    documents.push(createDocument(planFile, 'plan', planPath));
  }

  // 2. Scan phase-*.md or phase-*/ directories
  const rootFiles = readdirSync(planPath);
  for (const file of rootFiles) {
    const fullPath = join(planPath, file);
    const stat = statSync(fullPath);

    if (file.startsWith('phase-')) {
      if (stat.isDirectory()) {
        // Check for phase.md inside directory
        const phaseFile = join(fullPath, 'phase.md');
        if (existsSync(phaseFile)) {
          documents.push(createDocument(phaseFile, 'phase', planPath));
        }
      } else if (file.endsWith('.md')) {
        documents.push(createDocument(fullPath, 'phase', planPath));
      }
    }
  }

  // 3. Scan research/ folder
  const researchDir = join(planPath, 'research');
  if (existsSync(researchDir)) {
    const researchFiles = readdirSync(researchDir).filter(f => f.endsWith('.md'));
    for (const file of researchFiles) {
      documents.push(createDocument(join(researchDir, file), 'research', planPath));
    }
  }

  // 4. Scan artifacts/ folder
  const artifactsDir = join(planPath, 'artifacts');
  if (existsSync(artifactsDir)) {
    const artifactFiles = readdirSync(artifactsDir);
    for (const file of artifactFiles) {
      const fullPath = join(artifactsDir, file);
      if (statSync(fullPath).isFile()) {
        documents.push(createDocument(fullPath, 'artifact', planPath));
      }
    }
  }

  // 5. Scan reports/ folder
  const reportsDir = join(planPath, 'reports');
  if (existsSync(reportsDir)) {
    const reportFiles = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
    for (const file of reportFiles) {
      documents.push(createDocument(join(reportsDir, file), 'report', planPath));
    }
  }

  // Sort by modification time (newest first)
  documents.sort((a, b) => b.modifiedAt - a.modifiedAt);

  return documents;
}

/**
 * Group documents by type for display
 */
export function groupDocumentsByType(documents: PlanDocument[]): Record<DocumentType, PlanDocument[]> {
  return {
    plan: documents.filter(d => d.type === 'plan'),
    phase: documents.filter(d => d.type === 'phase')
      .sort((a, b) => (b.phaseNumber || 0) - (a.phaseNumber || 0)),
    research: documents.filter(d => d.type === 'research'),
    artifact: documents.filter(d => d.type === 'artifact'),
    report: documents.filter(d => d.type === 'report'),
    other: documents.filter(d => d.type === 'other'),
  };
}
